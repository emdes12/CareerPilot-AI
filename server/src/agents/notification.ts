import { z } from 'zod';
import { config } from '../config.js';
import { json, one, q } from '../db.js';
import { defineAgent } from './core/types.js';

/**
 * Notification Agent (deterministic content, no LLM). Sends from the CareerPilot AI notifications identity
 * to YOUR notification inbox only, and optionally WhatsApp via Meta's official Cloud API.
 * Each channel is independent: WhatsApp being disconnected never stops the email, and vice versa.
 * Each (kind, job, channel) is sent at most once; "not_configured" outcomes are recorded honestly.
 */
const Kind = z.enum(['opportunity', 'application_result', 'config_required']);
const ChannelResult = z.object({ channel: z.string(), status: z.string(), detail: z.string().nullable() });

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmtN = (n: number | null | undefined) => (n == null ? '' : `₦${Math.round(n).toLocaleString('en-US')}`);
const day = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const ATTEMPT_LABEL: Record<string, string> = {
  submitted: 'Submitted (email accepted by Resend)', manual_required: 'Awaiting your manual submission', blocked: 'Blocked — not sent',
  pending_approval: 'Pending your approval', failed: 'Failed — not sent', skipped: 'Skipped (already in progress/submitted)',
};

export const notificationAgent = defineAgent({
  name: 'notification',
  version: '1.0.0',
  description: 'Emails (and optionally WhatsApps) you about matches ≥ your threshold, application outcomes and configuration problems. Deduplicated; honest about channel status.',
  modelClass: null,
  systemPrompt: null,
  input: z.object({ jobId: z.number(), kind: Kind, attemptId: z.number().nullable().optional() }),
  output: z.object({ results: z.array(ChannelResult) }),
  tools: ['automation.read', 'email.sendNotification', 'whatsapp.send', 'whatsapp.status', 'events.record'],
  dependsOn: ['tracking'],
  retry: { attempts: 2, backoffMs: 5000 },
  timeoutMs: 60000,
  async run(ctx, input) {
    ctx.markEngine('rules');
    const s = await ctx.tools['automation.read'](ctx.userId);
    const job = await one(`SELECT j.*, a.total_score, a.eligibility, a.salary, a.matched, a.missing, a.classification FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id WHERE j.id=$1 AND j.user_id=$2`, [input.jobId, ctx.userId]);
    if (!job) throw new Error('Job not found');
    const research = await one(`SELECT official_url, official_url_verified, apply_method FROM job_research WHERE job_id=$1`, [input.jobId]);
    const attempt = input.attemptId ? await one(`SELECT * FROM application_attempts WHERE id=$1`, [input.attemptId]) : await one(`SELECT * FROM application_attempts WHERE job_id=$1 ORDER BY id DESC LIMIT 1`, [input.jobId]);
    const fx = await one(`SELECT fx_updated_at FROM search_settings WHERE user_id=$1`, [ctx.userId]);
    const workspace = `${config.appBaseUrl}/jobs/${job.id}/workspace`;
    const score = Number(job.total_score ?? 0);
    const sal = job.salary ?? {};
    const salaryLine = sal.original
      ? `${sal.original} ≈ ${fmtN(sal.ngnMonthlyMin)}${sal.ngnMonthlyMax && sal.ngnMonthlyMax !== sal.ngnMonthlyMin ? `–${fmtN(sal.ngnMonthlyMax)}` : ''}/month (estimate, FX rate of ${day(fx?.fx_updated_at) ?? 'unknown date'})`
      : 'Not disclosed';
    const published = job.effective_published_at ? `${day(job.effective_published_at)}${job.publication_verified ? ' (verified on employer ATS)' : ' (publication date unverified)'}` : 'Publication date unverified';
    const elig = job.eligibility ?? {};
    const status = attempt ? ATTEMPT_LABEL[attempt.status] ?? attempt.status : score >= 75 ? 'Not attempted' : null;

    let subject: string; const lines: [string, string][] = [];
    if (input.kind === 'config_required') {
      subject = `Action needed: email applications are not configured — ${job.title}`;
      lines.push(['What happened', attempt?.reason ?? 'The job-application sender is not configured or not verified, so nothing was sent.'], ['What to do', 'Open Settings → Integrations in CareerPilot AI and follow the Resend setup steps for JOB_APPLICATION_FROM_EMAIL.']);
    } else {
      subject = input.kind === 'application_result' && attempt
        ? `${ATTEMPT_LABEL[attempt.status]?.split(' ')[0] ?? 'Update'}: ${job.title} at ${job.company_name}`
        : `${score}% match: ${job.title} at ${job.company_name}`;
      lines.push(
        ['Role', `${job.title} — ${job.company_name}`],
        ['Match score', `${score}/100 (${job.classification ?? ''}) — how closely the role matches your profile, not a hiring probability`],
        ['Salary', salaryLine],
        ['Nigeria eligibility', `${elig.status ?? 'unknown'}${elig.evidence?.[0] ? ` — “${String(elig.evidence[0]).slice(0, 160)}”` : ''}`],
        ['You match', (job.matched ?? []).slice(0, 8).join(', ') || '—'],
        ['Missing', (job.missing ?? []).slice(0, 6).join(', ') || 'Nothing significant'],
        ['Published', published],
        ['Source', `${job.source}${job.is_repost ? ' (re-listed vacancy)' : ''}`],
        ['Official application', research?.official_url ? `${research.official_url}${research.official_url_verified ? ' (verified)' : ' (unverified)'}` : job.apply_url ?? job.source_url],
      );
      if (status) lines.push(['Application status', `${status}${attempt?.reason ? ` — ${attempt.reason}` : ''}`]);
    }
    const cta = attempt?.status === 'manual_required' || attempt?.status === 'blocked' ? 'Complete Your Application' : attempt?.status === 'pending_approval' ? 'Review and approve' : 'Open workspace';
    const text = `${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${cta}: ${workspace}\n\n— CareerPilot AI`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:620px"><table cellpadding="6" style="border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="color:#555;vertical-align:top;white-space:nowrap">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:20px 0"><a href="${esc(workspace)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(cta)}</a></p><p style="color:#777;font-size:12px">Sent by CareerPilot AI to your notification address.</p></div>`;

    const dedupe = `${input.kind}:${input.jobId}${input.kind === 'application_result' && attempt ? `:${attempt.id}` : ''}`;
    const results: z.infer<typeof ChannelResult>[] = [];
    const already = async (channel: string) => !!(await one(`SELECT 1 FROM notifications WHERE dedupe_key=$1 AND channel=$2 AND status='sent'`, [dedupe, channel]));
    const save = (channel: string, st: string, recipient: string | null, id: string | null, err: string | null) =>
      q(`INSERT INTO notifications (user_id, job_id, kind, dedupe_key, channel, status, recipient, subject, provider_message_id, error, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [ctx.userId, input.jobId, input.kind, dedupe, channel, st, recipient, subject, id, err, json({ score, attemptStatus: attempt?.status ?? null })]);

    // Email
    if (!s.notify_email_enabled) results.push({ channel: 'email', status: 'disabled', detail: 'Email notifications are off' });
    else if (await already('email')) results.push({ channel: 'email', status: 'duplicate', detail: 'Already notified' });
    else {
      const to = s.notification_email || config.notificationEmail;
      const r = await ctx.tools['email.sendNotification']({ to, subject, text, html, userId: ctx.userId, jobId: input.jobId, idempotencyKey: `notify-${dedupe}` });
      const st = r.ok ? 'sent' : r.status === 'not_configured' ? 'not_configured' : 'failed';
      await save('email', st, to, r.id, r.error);
      results.push({ channel: 'email', status: st, detail: r.error ?? `Resend id ${r.id}` });
    }
    // WhatsApp (optional, independent)
    if (!s.notify_whatsapp_enabled) results.push({ channel: 'whatsapp', status: 'disabled', detail: 'WhatsApp notifications are off' });
    else if (await already('whatsapp')) results.push({ channel: 'whatsapp', status: 'duplicate', detail: 'Already notified' });
    else {
      const to = s.whatsapp_to || config.whatsapp.to;
      const r = await ctx.tools['whatsapp.send'](to, `${job.title} at ${job.company_name}${status ? ` — ${status}` : ''}`, score, workspace);
      const st = r.ok ? 'sent' : r.status === 'not_configured' ? 'not_configured' : 'failed';
      await save('whatsapp', st, to || null, r.id, r.error);
      results.push({ channel: 'whatsapp', status: st, detail: r.error ?? `Message id ${r.id}` });
    }
    await ctx.tools['events.record'](ctx.userId, input.jobId, 'notification', results.map((r) => `${r.channel}: ${r.status}`).join(', '), 'agent:notification', { kind: input.kind, results });
    ctx.log(results.map((r) => `${r.channel}=${r.status}`).join(' '));
    return { results };
  },
});
