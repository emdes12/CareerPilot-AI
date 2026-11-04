import { z } from 'zod';
import { aiStatus, callLlm } from '../../ai/provider.js';
import { scopedTools } from './tools.js';
import type { AgentContext, AgentDefinition } from './types.js';

export interface AgentRunResult<O> { output: O; engine: string; attempts: number; log: { at: string; msg: string; data?: unknown }[]; toolsUsed: string[] }

function stripFences(s: string) {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = (m ? m[1] : s).trim();
  const start = body.search(/[[{]/);
  return start > 0 ? body.slice(start) : body;
}

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);

/** Execute one agent: validate input → run with retries/timeout → validate output. */
export async function runAgent<I, O>(def: AgentDefinition<I, O>, rawInput: unknown, meta: { userId: number; runId: number | null; taskId: number | null }): Promise<AgentRunResult<O>> {
  const input = def.input.parse(rawInput);
  const log: AgentRunResult<O>['log'] = [];
  const toolsUsed = new Set<string>();
  const engines = new Set<string>();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= def.retry.attempts; attempt++) {
    const ctx: AgentContext = {
      userId: meta.userId, runId: meta.runId, taskId: meta.taskId, agent: def.name,
      tools: scopedTools(def.name, def.tools, (t) => toolsUsed.add(t)),
      log: (msg, data) => { log.push({ at: new Date().toISOString(), msg, ...(data !== undefined ? { data } : {}) }); },
      markEngine: (e) => engines.add(e),
      llm: {
        enabled: !!def.modelClass && aiStatus().enabled,
        async json<T>(schema: z.ZodType<T>, prompt: string, opts: { maxTokens?: number } = {}) {
          if (!def.modelClass || !def.systemPrompt) return null;
          const sys = `${def.systemPrompt}\n\nRespond with a single JSON object only. No prose, no markdown fences.`;
          let res = await callLlm(meta.userId, def.modelClass, sys, prompt, opts.maxTokens ?? 2500, { agent: def.name, runId: meta.runId, json: true });
          for (let repair = 0; res && repair < 2; repair++) {
            try {
              const parsed = schema.safeParse(JSON.parse(stripFences(res.text)));
              if (parsed.success) { engines.add(`ai:${res.model}`); return parsed.data; }
              ctx.log('LLM output failed schema validation', parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`));
              if (repair === 1) break;
              res = await callLlm(meta.userId, def.modelClass, sys, `${prompt}\n\nYour previous answer did not match the required schema:\n${parsed.error.issues.slice(0, 8).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}\nReturn corrected JSON only.`, opts.maxTokens ?? 2500, { agent: def.name, runId: meta.runId, json: true });
            } catch {
              ctx.log('LLM returned non-JSON output');
              if (repair === 1) break;
              res = await callLlm(meta.userId, def.modelClass, sys, `${prompt}\n\nReturn valid JSON only.`, opts.maxTokens ?? 2500, { agent: def.name, runId: meta.runId, json: true });
            }
          }
          ctx.log('LLM unavailable or invalid — using deterministic baseline');
          return null;
        },
        async text(prompt: string, opts: { maxTokens?: number; system?: string } = {}) {
          if (!def.modelClass) return null;
          const r = await callLlm(meta.userId, def.modelClass, opts.system ?? def.systemPrompt ?? '', prompt, opts.maxTokens ?? 1500, { agent: def.name, runId: meta.runId });
          if (r) engines.add(`ai:${r.model}`);
          return r?.text ?? null;
        },
      },
    };
    try {
      const out = await withTimeout(def.run(ctx, input), def.timeoutMs, def.name);
      const valid = def.output.parse(out);
      const engine = engines.size === 0 ? 'rules' : [...engines].some((e) => e === 'rules') && engines.size > 1 ? 'mixed' : [...engines].join(',');
      return { output: valid, engine, attempts: attempt, log, toolsUsed: [...toolsUsed] };
    } catch (e) {
      lastErr = e;
      log.push({ at: new Date().toISOString(), msg: `Attempt ${attempt} failed: ${(e as Error).message}` });
      if (e instanceof z.ZodError) break; // contract violation: retrying won't help
      if (attempt < def.retry.attempts) await new Promise((r) => setTimeout(r, def.retry.backoffMs * 2 ** (attempt - 1)));
    }
  }
  const err = lastErr as Error & { agentLog?: unknown };
  err.agentLog = log;
  throw err;
}
