import { z } from 'zod';
import { runDiscovery } from '../engine/discovery.js';
import { defineAgent } from './core/types.js';

/**
 * Job Discovery Agent (deterministic — no LLM): queries all enabled official APIs/feeds and ATS boards,
 * filters to remote software roles, and hands candidates to the store service (dedupe/upsert) and the
 * scoring service for fast triage. Per-source failures are isolated and logged in source_logs.
 */
export const jobDiscoveryAgent = defineAgent({
  name: 'job-discovery',
  version: '1.0.0',
  description: 'Searches every enabled job source and company ATS board; filters, dedupes and stores real vacancies.',
  modelClass: null,
  systemPrompt: null,
  input: z.object({ trigger: z.enum(['manual', 'schedule']), sources: z.array(z.string()).optional() }),
  output: z.object({ runId: z.number(), fetched: z.number(), relevant: z.number(), inserted: z.number(), updated: z.number(), duplicates: z.number(), reposts: z.number(), analysed: z.number(), failedSources: z.number(), newJobIds: z.array(z.number()) }),
  tools: ['sources.list', 'store.upsertJob'],
  dependsOn: [],
  retry: { attempts: 1, backoffMs: 0 },
  timeoutMs: 30 * 60 * 1000,
  async run(ctx, input) {
    void ctx.tools['sources.list'];
    const r = await runDiscovery(ctx.userId, input.trigger, input.sources);
    ctx.markEngine('rules');
    ctx.log(`Fetched ${r.fetched}, relevant ${r.relevant}, new ${r.inserted}, duplicates ${r.duplicates}, failed sources ${r.failedSources}`);
    return r;
  },
});
