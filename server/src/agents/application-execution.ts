import { z } from 'zod';
import { config } from '../config.js';
import { json, one, q } from '../db.js';
import { saveDoc } from '../docs/generate.js';
import { defineAgent } from './core/types.js';

/**
 * Application Execution Agent.
 * - EMAIL: sends only to an application address the listing itself published, only when every policy check
 *   passes, and only from the candidate's own verified identity (JOB_APPLICATION_FROM_*). Recorded as
 *   "submitted" only when Resend accepts the message and returns an id.
 * - PORTAL: Greenhouse/Lever/Ashby/Workable public APIs do not allow candidate-side submission (employer API
 *   keys are required) and their forms use CAPTCHA and terms acceptance. This agent never bypasses those, so
 *   portal applications always become a manual handoff package.
 */
const Status = z.enum(['submitted', 'manual_required', 'blocked', 'pending_approval', 'failed', 'skipped']);

export const applicationExecutionAgent = defineAgent({
  name: 'application-execution',
  version: '1.0.0',
  description: 'Runs every permission check, then submits by email (verified listing address + candidate identity) or prepares a manual handoff package. Records every attempt.',
  modelClass: null,
  systemPrompt: null,
  input: z.object({ jobId: z.number(), requestedBy: z.enum(['auto', 'user']) }),
  output: z.object({ attemptId: z.number().nullable(), status: Status, channel: z.string(), reason: z.string(), handoffDocumentId: z.number().nullable(), checks: z.array(z.any()) }),
  tools: ['policy.evaluateSubmission', 'identity.status', 'docs.latest', 'docs.renderCvPdf', 'docs.renderLetterPdf', 'email.sendApplication', 'events.record', 'profile.read'],
  dependsOn: ['cv-generation', 'cover-letter', 'application-research'],
  retry: { attempts: 1, backoffMs: 0 },
  timeoutMs: 180000,
  async run(ctx, input) {
    ctx.markEngine('rules');
    const ev = await ctx.tools['policy.evaluateSubmission'](ctx.userId, input.jobId, input.requestedBy);
    const { job, research } = ev;
    const actor = input.requestedBy === 'user' ? 'user' : 'agent:application-execution';
    const record = async (status: z.infer<typeof Status>, reason: string, extra: Record<string, unknown> = {}) => {
      const a = await one<{ id: number }>(`INSERT INTO application_attempts (user_id, job_id, channel, status, reason, requested_by, destination, recipient, subject, body, attachments, provider, provider_message_id, provider_status, provider_response, checks)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [ctx.userId, input.jobId, ev.channel, status, reason, input.requestedBy, research?.official_url ?? job.apply_url, extra.recipient ?? null, extra.subject ?? null, extra.body ?? null,
          json(extra.attachments ?? []), extra.provider ?? null, extra.providerId ?? null, extra.providerStatus ?? null, json(extra.providerResponse ?? null), json(ev.checks)]);
      await ctx.tools['events.record'](ctx.userId, input.jobId, 'attempt', `Application ${status.replace('_', ' ')}: ${reason}`, actor, { attemptId: a!.id, channel: ev.channel });
      return a!.id;
    };
    const handoff = async (reason: string) => {
      const p = await ctx.tools['profile.read'](ctx.userId);
      const docs = await ctx.tools['docs.latest'](ctx.userId, input.jobId);
      const by = (k: string) => docs.find((d: any) => d.kind === k);
      const answers = by('answers')?.content;
      const content = {
        cta: 'Complete Your Application',
        reason,
        job: { id: job.id, title: job.title, company: job.company_name, score: ev.score, tier: ev.tier },
        destination: { url: research?.official_url ?? job.apply_url, verified: !!research?.official_url_verified, method: research?.apply_method ?? 'external_link', ats: research?.ats ?? null },
        workspaceUrl: `${config.appBaseUrl}/jobs/${job.id}/workspace`,
        documents: { cvId: by('cv')?.id ?? null, coverLetterId: by('cover_letter')?.id ?? null, emailId: by('email')?.id ?? null, answersId: by('answers')?.id ?? null },
        requiredDocuments: research?.required_documents ?? [],
        screeningQuestions: answers?.formQuestions ?? [],
        steps: [
          `Open the official application page: ${research?.official_url ?? job.apply_url}`,
          'Download your tailored CV (PDF) and cover letter from the workspace.',
          ...(research?.steps ?? []).filter((s: string) => !/^open/i.test(s)),
          'Paste the prepared screening answers and review every [BRACKETED] item.',
          'Complete any CAPTCHA, account sign-in or terms acceptance yourself.',
          'Submit, then click "Mark as applied" in the workspace so tracking stays accurate.',
        ],
        checks: ev.checks,
        candidate: { name: p.profile.full_name, email: p.profile.email },
      };
      const d = await saveDoc(ctx.userId, input.jobId, 'handoff', `Handoff — ${job.title} @ ${job.company_name}`, content, 'rules-v1', []);
      await q(`UPDATE applications SET handoff_document_id=$2 WHERE job_id=$1`, [input.jobId, d.id]);
      return d.id as number;
    };

    // Portal: never automated.
    if (ev.channel !== 'email') {
      const reason = ev.channel === 'portal'
        ? 'This employer takes applications through its own portal. Automated portal submission is not supported (it would require the employer\'s API key or getting past CAPTCHA/terms), so a handoff package was prepared.'
        : 'No verified application destination was found. A handoff package with what is known was prepared.';
      const hid = await handoff(reason);
      const id = await record('manual_required', reason);
      return { attemptId: id, status: 'manual_required' as const, channel: ev.channel, reason, handoffDocumentId: hid, checks: ev.checks };
    }

    if (!ev.allowed) {
      const approvalOnly = ev.failed.every((c) => /approval|Auto-apply enabled/i.test(c.check));
      const reason = ev.failed.map((c) => `${c.check}: ${c.detail}`).join('; ');
      if (approvalOnly && input.requestedBy === 'auto') {
        await q(`UPDATE applications SET approval_status='pending' WHERE job_id=$1 AND approval_status <> 'approved'`, [input.jobId]);
        const id = await record('pending_approval', reason);
        return { attemptId: id, status: 'pending_approval' as const, channel: 'email', reason, handoffDocumentId: null, checks: ev.checks };
      }
      const hid = await handoff(`Not sent automatically — ${reason}`);
      const id = await record('blocked', reason);
      return { attemptId: id, status: 'blocked' as const, channel: 'email', reason, handoffDocumentId: hid, checks: ev.checks };
    }

    // Sender identity: the candidate's own address, verified in Resend. No fallback to the notifications sender.
    const ident = await ctx.tools['identity.status']('job_application');
    if (!ident.configured) {
      const reason = `Your job-application sender is not ready (${ident.detail}). Nothing was sent.`;
      const hid = await handoff(reason);
      const id = await record('blocked', reason);
      return { attemptId: id, status: 'blocked' as const, channel: 'email', reason, handoffDocumentId: hid, checks: [...ev.checks, { check: 'Job-application sender verified', ok: false, detail: ident.detail }] };
    }

    // Claim the submission slot first (unique index prevents a duplicate concurrent send).
    let slot: { id: number } | null = null;
    try {
      slot = await one<{ id: number }>(`INSERT INTO application_attempts (user_id, job_id, channel, status, reason, requested_by, recipient, checks) VALUES ($1,$2,'email','in_progress','Sending',$3,$4,$5) RETURNING id`,
        [ctx.userId, input.jobId, input.requestedBy, research.apply_email, json(ev.checks)]);
    } catch {
      return { attemptId: null, status: 'skipped' as const, channel: 'email', reason: 'Another submission for this job is already in progress or completed.', handoffDocumentId: null, checks: ev.checks };
    }
    try {
    const docs = await ctx.tools['docs.latest'](ctx.userId, input.jobId);
    const cv = docs.find((d: any) => d.kind === 'cv'); const cl = docs.find((d: any) => d.kind === 'cover_letter'); const em = docs.find((d: any) => d.kind === 'email');
    const p = await ctx.tools['profile.read'](ctx.userId);
    const safeName = p.profile.full_name.replace(/[^\w]+/g, '_');
    const attachments = [
      { filename: `${safeName}_CV.pdf`, content: await ctx.tools['docs.renderCvPdf'](cv.content) },
      { filename: `${safeName}_Cover_Letter.pdf`, content: await ctx.tools['docs.renderLetterPdf'](p.profile.full_name, `${p.profile.email} · ${p.profile.phone}`, cl.content) },
    ];
    const subject = em?.content?.subject ?? `Application: ${job.title} — ${p.profile.full_name}`;
    const body = em?.content?.body ?? cl.content.paragraphs.join('\n\n');
    const r = await ctx.tools['email.sendApplication']({ to: research.apply_email, subject, text: body, attachments, replyTo: p.profile.email, idempotencyKey: `application-${input.jobId}`, userId: ctx.userId, jobId: input.jobId });
    const status = r.ok ? 'submitted' as const : 'failed' as const;
    const reason = r.ok ? `Sent by email to ${research.apply_email} from ${r.from}; Resend id ${r.id}` : `Email not sent: ${r.error}`;
    await q(`UPDATE application_attempts SET status=$2, reason=$3, destination=$4, subject=$5, body=$6, attachments=$7, provider='resend', provider_message_id=$8, provider_status=$9, provider_response=$10 WHERE id=$1`,
      [slot!.id, status, reason, `mailto:${research.apply_email}`, subject, body, json(attachments.map((a) => ({ filename: a.filename, bytes: a.content.length }))), r.id, r.status, json(r.providerResponse)]);
    await ctx.tools['events.record'](ctx.userId, input.jobId, 'attempt', `Application ${status}: ${reason}`, actor, { attemptId: slot!.id, channel: 'email', emailLogId: r.logId });
    if (r.ok) await q(`UPDATE applications SET status='applied', applied_at=COALESCE(applied_at, now()), updated_at=now(), history = history || $2::jsonb WHERE job_id=$1`,
      [input.jobId, json([{ status: 'applied', at: new Date().toISOString(), note: `Submitted by email (Resend ${r.id})` }])]);
    ctx.log(reason);
    return { attemptId: slot!.id, status, channel: 'email', reason, handoffDocumentId: null, checks: ev.checks };
    } catch (e) {
      // Never leave the slot "in progress": an exception before Resend accepted the email means nothing was sent.
      await q(`UPDATE application_attempts SET status='failed', reason=$2 WHERE id=$1 AND status='in_progress'`, [slot!.id, `Failed before sending: ${(e as Error).message}`]);
      throw e;
    }
  },
});
