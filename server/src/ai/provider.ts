import { config } from '../config.js';
import { one, q } from '../db.js';

/**
 * Provider-agnostic LLM client.
 *  - openai / openrouter / gemini / any OpenAI-compatible endpoint → POST {base}/chat/completions
 *  - anthropic → POST {base}/v1/messages
 * AI is OPTIONAL: every agent has a deterministic baseline; this client only adds reasoning/wording.
 */
export type AiTask = 'research' | 'scoring' | 'documents';
export interface CallMeta { agent?: string; runId?: number | null; model?: string; json?: boolean }
export interface LlmResult { text: string; model: string; inputTokens: number; outputTokens: number }

const DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com',
};
// Approximate USD per 1M tokens [input, output]; unknown models are tracked at 0 (tokens are still recorded).
const PRICES: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6], 'gpt-4o': [2.5, 10], 'gpt-4.1-mini': [0.4, 1.6], 'gemini-2.5-flash': [0.3, 2.5],
  'claude-haiku-5-5': [1, 5], 'claude-sonnet-5-5': [3, 15], 'claude-opus-5-5': [5, 25],
};

export function aiStatus() {
  const enabled = !!(config.ai.provider && config.ai.apiKey);
  return {
    enabled, provider: config.ai.provider || null, models: config.ai.models, fallbackModels: config.ai.fallbackModels,
    baseUrl: enabled ? config.ai.baseUrl || DEFAULT_BASE[config.ai.provider] : null, monthlyBudgetUsd: config.ai.monthlyBudgetUsd,
  };
}

/** Model for an agent: AGENT_MODEL_<AGENT_NAME> → task-class model → AI_MODEL. */
export function modelFor(agent: string | undefined, task: AiTask): string {
  const envKey = agent ? `AGENT_MODEL_${agent.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}` : '';
  return (envKey && process.env[envKey]) || config.ai.models[task] || '';
}

export async function monthSpend(): Promise<number> {
  const r = await one<{ s: number }>(`SELECT COALESCE(SUM(cost_usd),0) s FROM ai_usage WHERE created_at >= date_trunc('month', now())`);
  return Number(r?.s ?? 0);
}

/** Call the model chain (primary + fallbacks). Returns null when AI is disabled, over budget, or every model failed. */
export async function callLlm(userId: number, task: AiTask, system: string, user: string, maxTokens = 1500, meta: CallMeta = {}): Promise<LlmResult | null> {
  const primary = meta.model || modelFor(meta.agent, task);
  if (!aiStatus().enabled || !primary) return null;
  // Circuit breaker: when every model was just overloaded/out of quota, skip AI briefly instead of
  // making each agent wait through the whole fallback chain. Agents use their deterministic baseline meanwhile.
  if (Date.now() < aiCooldownUntil) return null;
  const chain = [primary, ...config.ai.fallbackModels.filter((m) => m !== primary)];
  for (const model of chain) {
    const r = await callModel(userId, task, model, system, user, maxTokens, meta);
    if (r.result) return r.result;
    if (!r.retryable) return null;
  }
  aiCooldownUntil = Date.now() + 5 * 60 * 1000;
  console.warn('[ai] all models overloaded or out of quota — pausing AI calls for 5 minutes');
  return null;
}
let aiCooldownUntil = 0;
export const aiCooldown = () => (Date.now() < aiCooldownUntil ? new Date(aiCooldownUntil).toISOString() : null);

/** Back-compat helper returning just text. */
export async function complete(userId: number, task: AiTask, system: string, user: string, maxTokens = 1200, meta: CallMeta = {}): Promise<string | null> {
  return (await callLlm(userId, task, system, user, maxTokens, meta))?.text ?? null;
}

async function callModel(userId: number, task: AiTask, model: string, system: string, user: string, maxTokens: number, meta: CallMeta): Promise<{ result: LlmResult | null; retryable: boolean }> {
  const st = aiStatus();
  const logRow = (ok: boolean, inT: number, outT: number, cost: number, error: string | null) =>
    q(`INSERT INTO ai_usage (user_id, task, provider, model, input_tokens, output_tokens, cost_usd, ok, error, agent, run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [userId, task, st.provider, model, inT, outT, cost, ok, error, meta.agent ?? null, meta.runId ?? null]);
  if ((await monthSpend()) >= config.ai.monthlyBudgetUsd) { await logRow(false, 0, 0, 0, 'Monthly AI budget reached'); return { result: null, retryable: false }; }

  const base = (config.ai.baseUrl || DEFAULT_BASE[config.ai.provider] || '').replace(/\/$/, '');
  let lastStatus = 0;
  // Brief retry on overload (429/503); the caller then moves to the next fallback model.
  const post = async (url: string, headers: Record<string, string>, body: unknown): Promise<Response> => {
    let res!: Response;
    for (let i = 0; i < 2; i++) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 90000);
      try { res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal }); }
      finally { clearTimeout(t); }
      lastStatus = res.status;
      if (res.status !== 429 && res.status !== 503) return res;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
    return res;
  };
  try {
    let text = ''; let inT = 0; let outT = 0;
    if (config.ai.provider === 'anthropic') {
      const res = await post(`${base}/v1/messages`, { 'x-api-key': config.ai.apiKey, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
      const d: any = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? `HTTP ${res.status}`);
      text = (d.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      inT = d.usage?.input_tokens ?? 0; outT = d.usage?.output_tokens ?? 0;
    } else {
      const res = await post(`${base}/chat/completions`, { authorization: `Bearer ${config.ai.apiKey}` }, {
        model, max_tokens: maxTokens, temperature: 0.2,
        ...(meta.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      const d: any = await res.json();
      if (!res.ok) throw new Error(Array.isArray(d) ? d[0]?.error?.message : d?.error?.message ?? `HTTP ${res.status}`);
      text = d.choices?.[0]?.message?.content ?? '';
      inT = d.usage?.prompt_tokens ?? 0; outT = d.usage?.completion_tokens ?? 0;
    }
    const price = PRICES[model] ?? [0, 0];
    await logRow(true, inT, outT, (inT * price[0] + outT * price[1]) / 1e6, null);
    if (!text.trim()) return { result: null, retryable: true };
    return { result: { text: text.trim(), model, inputTokens: inT, outputTokens: outT }, retryable: false };
  } catch (e) {
    await logRow(false, 0, 0, 0, `${(e as Error).message}`.slice(0, 500));
    return { result: null, retryable: [0, 404, 429, 500, 503].includes(lastStatus) };
  }
}
