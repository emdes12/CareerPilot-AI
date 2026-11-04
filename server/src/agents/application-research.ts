import { z } from 'zod';
import { investigateApplication } from '../engine/research.js';
import { defineAgent } from './core/types.js';
import { quoteInText } from './schemas.js';

/**
 * Application Research Agent: finds and verifies the real application destination.
 * Verification (HTTP/ATS API checks) is deterministic; the LLM only interprets explicit
 * application instructions (e.g. "include the word X", "send a Loom") into extra steps.
 */
export const applicationResearchAgent = defineAgent({
  name: 'application-research',
  version: '1.0.0',
  description: 'Verifies the official application destination, open status, apply method, explicit apply email, form questions, required documents, deadline and steps.',
  modelClass: 'research',
  systemPrompt: `You are the Application Research Agent. You receive verbatim application-instruction sentences from a job listing.
Turn them into concrete extra steps and required items for the applicant. Each item must include "quote" copied verbatim from the provided sentences.
Never invent requirements, email addresses or links.`,
  input: z.object({ jobId: z.number(), website: z.string().nullable(), applicationInstructions: z.array(z.string()) }),
  output: z.object({ row: z.any(), company: z.any(), liveOk: z.boolean(), liveStatus: z.number(), extraSteps: z.array(z.string()) }),
  tools: ['http.checkUrl', 'http.fetchPublic', 'ats.fetchBoard', 'ats.greenhouseQuestions'],
  dependsOn: ['company-research', 'jd-extraction'],
  retry: { attempts: 2, backoffMs: 3000 },
  timeoutMs: 240000,
  async run(ctx, input) {
    // Touch the allow-listed tools this agent's service uses (keeps tool usage auditable).
    void ctx.tools['http.checkUrl'];
    const r = await investigateApplication(ctx.userId, input.jobId, { website: input.website });
    ctx.markEngine('rules');
    let extraSteps: string[] = [];
    if (input.applicationInstructions.length && ctx.llm.enabled) {
      const src = input.applicationInstructions.join('\n');
      const out = await ctx.llm.json(z.object({ steps: z.array(z.object({ step: z.string(), quote: z.string() })).max(6), documents: z.array(z.object({ item: z.string(), quote: z.string() })).max(6) }), `APPLICATION INSTRUCTIONS:\n${src}`);
      if (out) {
        extraSteps = out.steps.filter((s) => quoteInText(s.quote, src)).map((s) => `${s.step} (listing says: “${s.quote}”)`);
        for (const d of out.documents.filter((d) => quoteInText(d.quote, src))) if (!r.row.required_documents.includes(d.item)) r.row.required_documents.push(d.item);
      }
    }
    if (extraSteps.length) r.row.steps.splice(Math.max(0, r.row.steps.length - 1), 0, ...extraSteps);
    ctx.log(`Destination ${r.row.official_url_verified ? 'VERIFIED' : 'unverified'} via ${r.row.apply_method}; ${r.row.log.length} checks`);
    return { ...r, extraSteps };
  },
});
