import { z } from 'zod';
import { json, one, q } from '../db.js';
import { TIERS } from '../engine/policy.js';
import { defineAgent } from './core/types.js';

/**
 * Application Tracking Agent (deterministic). Keeps the application record and its activity history in step
 * with what the other agents did. It never invents a status: "applied" is set only by a confirmed submission
 * or by the user.
 */
export const trackingAgent = defineAgent({
  name: 'tracking',
  version: '1.0.0',
  description: 'Updates the application record (tier, automation status, documents) and writes the per-application activity history.',
  modelClass: null,
  systemPrompt: null,
  input: z.object({
    jobId: z.number(), score: z.number(), tier: z.string(), actionable: z.boolean(),
    documents: z.object({ cvId: z.number().nullable(), coverLetterId: z.number().nullable(), qaPassed: z.boolean().nullable() }).nullable(),
    attempt: z.object({ attemptId: z.number().nullable(), status: z.string(), reason: z.string() }).nullable(),
    expired: z.boolean().optional(),
  }),
  output: z.object({ status: z.string(), automationStatus: z.string().nullable(), events: z.number() }),
  tools: ['events.record'],
  dependsOn: ['application-execution'],
  retry: { attempts: 2, backoffMs: 1000 },
  timeoutMs: 30000,
  async run(ctx, input) {
    ctx.markEngine('rules');
    let events = 0;
    const ev = async (type: string, msg: string, data: unknown = {}) => { await ctx.tools['events.record'](ctx.userId, input.jobId, type, msg, 'agent:tracking', data); events++; };
    const app = await one(`SELECT * FROM applications WHERE job_id=$1`, [input.jobId]);
    const tierInfo = TIERS.find((t) => t.tier === input.tier);
    if (app?.tier !== input.tier) await ev('tier_assigned', `${tierInfo?.label ?? input.tier}: ${tierInfo?.action ?? ''}`, { score: input.score });
    if (input.expired) await ev('status_change', 'Vacancy no longer open — pipeline stopped');
    if (input.documents?.cvId) await ev('documents_generated', `Tailored documents prepared${input.documents.qaPassed === false ? ' — QA found issues to fix before sending' : ''}`, input.documents);
    const automationStatus = input.attempt?.status ?? (input.score >= 75 ? 'not_attempted' : null);
    let status = app?.status ?? 'discovered';
    if (input.documents?.cvId && ['discovered', 'recommended', 'analysing'].includes(status)) status = 'ready_to_apply';
    if (input.attempt?.status === 'submitted') status = 'applied';
    await q(`UPDATE applications SET tier=$2, automation_status=COALESCE($3, automation_status),
               cv_document_id=COALESCE($4, cv_document_id), cover_document_id=COALESCE($5, cover_document_id),
               status=$6, updated_at=now(),
               history = CASE WHEN status <> $6 THEN history || $7::jsonb ELSE history END
             WHERE job_id=$1`,
      [input.jobId, input.tier, automationStatus, input.documents?.cvId ?? null, input.documents?.coverLetterId ?? null, status,
        json([{ status, at: new Date().toISOString(), note: input.attempt ? `Automation: ${input.attempt.status}` : 'Pipeline update' }])]);
    return { status, automationStatus, events };
  },
});
