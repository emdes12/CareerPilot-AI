import { Router, type Response } from 'express';
import zlib from 'node:zlib';
import { z } from 'zod';
import { aiStatus } from '../ai/provider.js';
import type { AuthedRequest } from '../auth.js';
import { config } from '../config.js';
import { json, one, q } from '../db.js';
import { addClaim, confirmClaim, evidenceSummary, ingestCvText, rejectClaim, resolveConflict, updateClaim } from '../engine/evidence.js';
import { getAutomation, recordEvent, TIERS, updateAutomation } from '../engine/policy.js';
import { loadProfile } from '../engine/profile.js';
import { identityStatus, sendEmail } from '../integrations/resend.js';
import { whatsappStatus } from '../integrations/whatsapp.js';
import { getRun, listWorkflows, startWorkflow } from '../agents/core/orchestrator.js';
import { listAgents } from '../agents/registry.js';

/** Routes for the multi-agent pipeline, automation permissions, evidence base and integrations. All require auth. */
export const automation = Router();
type R = AuthedRequest;
const wrap = (fn: (req: R, res: Response) => Promise<unknown>) => (req: R, res: Response) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e instanceof z.ZodError ? 400 : e.status ?? 500).json({ error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.message });
});
const ownJob = async (userId: number, id: number) => { const j = await one('SELECT id FROM jobs WHERE id=$1 AND user_id=$2', [id, userId]); if (!j) throw Object.assign(new Error('Job not found'), { status: 404 }); return j; };

// ---------- Agents & workflows ----------
automation.get('/agents', (_req, res) => { res.json({ agents: listAgents(), workflows: listWorkflows().map((w) => ({ name: w.name, description: w.description, subject: w.subject, steps: w.steps.map((s) => ({ id: s.id, agent: s.agent ?? null, service: s.service?.name ?? null, needs: s.needs ?? [] })) })) }); });
automation.get('/runs', wrap(async (req, res) => res.json(await q(`SELECT r.id, r.workflow, r.subject_type, r.subject_id, r.status, r.trigger, r.created_at, r.started_at, r.finished_at, r.summary, r.error,
  j.title AS job_title, j.company_name FROM workflow_runs r LEFT JOIN jobs j ON r.subject_type='job' AND j.id=r.subject_id WHERE r.user_id=$1 ORDER BY r.id DESC LIMIT 100`, [req.userId]))));
automation.get('/runs/:id', wrap(async (req, res) => {
  const r = await getRun(Number(req.params.id));
  if (!r || r.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  res.json(r);
}));
automation.post('/workflows/:name', wrap(async (req, res) => {
  const name = req.params.name as string;
  if (!['opportunity', 'discovery', 'profile-refresh'].includes(name)) return res.status(400).json({ error: 'Use /jobs/:id/approve to start an application attempt.' });
  if (req.body?.jobId) await ownJob(req.userId!, Number(req.body.jobId));
  res.json({ runId: await startWorkflow(req.userId!, name, { ...(req.body ?? {}), manual: true }, 'manual') });
}));
/** Run the full agent pipeline for one job (docs always generated; no automatic submission or notification for a manual run). */
automation.post('/jobs/:id/pipeline', wrap(async (req, res) => {
  const id = Number(req.params.id); await ownJob(req.userId!, id);
  res.json({ runId: await startWorkflow(req.userId!, 'opportunity', { jobId: id, manual: true, forceDocs: true }, 'manual') });
}));

// ---------- Approvals & manual actions ----------
automation.post('/jobs/:id/approve', wrap(async (req, res) => {
  const id = Number(req.params.id); await ownJob(req.userId!, id);
  await q(`UPDATE applications SET approval_status='approved', approved_at=now(), updated_at=now() WHERE job_id=$1`, [id]);
  await recordEvent(req.userId!, id, 'approval_granted', 'You approved sending this application', 'user');
  res.json({ runId: await startWorkflow(req.userId!, 'apply', { jobId: id }, 'manual') });
}));
automation.post('/jobs/:id/reject', wrap(async (req, res) => {
  const id = Number(req.params.id); await ownJob(req.userId!, id);
  await q(`UPDATE applications SET approval_status='rejected', updated_at=now() WHERE job_id=$1`, [id]);
  await recordEvent(req.userId!, id, 'approval_rejected', 'You declined automatic sending for this application', 'user');
  res.json({ ok: true });
}));
automation.post('/jobs/:id/mark-applied', wrap(async (req, res) => {
  const id = Number(req.params.id); await ownJob(req.userId!, id);
  const note = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {}).note ?? 'Applied manually';
  await q(`UPDATE applications SET status='applied', applied_at=COALESCE(applied_at, now()), automation_status=CASE WHEN automation_status IN ('manual_required','blocked','pending_approval') THEN 'completed_manually' ELSE automation_status END,
           updated_at=now(), history = history || $2::jsonb WHERE job_id=$1`, [id, json([{ status: 'applied', at: new Date().toISOString(), note }])]);
  await recordEvent(req.userId!, id, 'manual_action', `Marked as applied: ${note}`, 'user');
  res.json({ ok: true });
}));
automation.get('/jobs/:id/activity', wrap(async (req, res) => {
  const id = Number(req.params.id); await ownJob(req.userId!, id);
  const [events, attempts, notifications, emails, runs] = await Promise.all([
    q(`SELECT * FROM application_events WHERE job_id=$1 ORDER BY created_at DESC`, [id]),
    q(`SELECT id, channel, status, reason, requested_by, destination, recipient, subject, attachments, provider, provider_message_id, provider_status, checks, created_at FROM application_attempts WHERE job_id=$1 ORDER BY id DESC`, [id]),
    q(`SELECT id, kind, channel, status, recipient, subject, error, created_at FROM notifications WHERE job_id=$1 ORDER BY id DESC`, [id]),
    q(`SELECT id, identity, from_name, from_email, to_email, subject, attachments, status, provider_id, error, created_at FROM email_log WHERE job_id=$1 ORDER BY id DESC`, [id]),
    q(`SELECT id, workflow, status, created_at, finished_at, summary FROM workflow_runs WHERE subject_type='job' AND subject_id=$1 ORDER BY id DESC LIMIT 20`, [id]),
  ]);
  res.json({ events, attempts, notifications, emails, runs });
}));

// ---------- Automation settings & dashboard ----------
automation.get('/automation', wrap(async (req, res) => res.json({ settings: await getAutomation(req.userId!), tiers: TIERS, note: 'Match scores describe how well a role fits your profile. They are not hiring probabilities.' })));
automation.put('/automation', wrap(async (req, res) => {
  const b = z.object({
    auto_apply_enabled: z.boolean(), auto_apply_min_score: z.number().int().min(75).max(100), require_approval: z.boolean(),
    allow_email_applications: z.boolean(), allow_portal_applications: z.boolean(), max_applications_per_day: z.number().int().min(0).max(50),
    excluded_companies: z.array(z.string()), excluded_keywords: z.array(z.string()), paused: z.boolean(),
    notify_email_enabled: z.boolean(), notify_whatsapp_enabled: z.boolean(), notification_email: z.string().email().nullable(), whatsapp_to: z.string().nullable(),
    notify_min_score: z.number().int().min(0).max(100), docs_min_score: z.number().int().min(0).max(100),
  }).partial().parse(req.body);
  // Enabling auto-submission must be a deliberate, explicit choice.
  if (b.auto_apply_enabled === true && req.body?.confirm !== 'ENABLE AUTO-APPLY') return res.status(400).json({ error: 'To enable automatic submission, send confirm: "ENABLE AUTO-APPLY".' });
  res.json(await updateAutomation(req.userId!, b as any));
}));
automation.get('/automation/dashboard', wrap(async (req, res) => {
  const u = req.userId;
  const [counts, attempts, pending, notifications, audit, byTier] = await Promise.all([
    one(`SELECT count(*) FILTER (WHERE status='submitted')::int submitted, count(*) FILTER (WHERE status='manual_required')::int manual, count(*) FILTER (WHERE status='blocked')::int blocked,
          count(*) FILTER (WHERE status='pending_approval')::int pending, count(*) FILTER (WHERE status='failed')::int failed FROM application_attempts WHERE user_id=$1`, [u]),
    q(`SELECT t.id, t.job_id, t.channel, t.status, t.reason, t.requested_by, t.recipient, t.created_at, j.title, j.company_name FROM application_attempts t JOIN jobs j ON j.id=t.job_id WHERE t.user_id=$1 ORDER BY t.id DESC LIMIT 50`, [u]),
    q(`SELECT ap.job_id, j.title, j.company_name, a.total_score FROM applications ap JOIN jobs j ON j.id=ap.job_id LEFT JOIN job_analyses a ON a.job_id=ap.job_id WHERE ap.user_id=$1 AND ap.approval_status='pending' ORDER BY a.total_score DESC`, [u]),
    q(`SELECT n.id, n.job_id, n.kind, n.channel, n.status, n.subject, n.error, n.created_at FROM notifications n WHERE n.user_id=$1 ORDER BY n.id DESC LIMIT 50`, [u]),
    q(`SELECT * FROM settings_audit WHERE user_id=$1 ORDER BY id DESC LIMIT 20`, [u]),
    q(`SELECT tier, count(*)::int n FROM applications WHERE user_id=$1 AND tier IS NOT NULL GROUP BY tier`, [u]),
  ]);
  res.json({ counts, attempts, pendingApprovals: pending, notifications, settingsAudit: audit, byTier });
}));
automation.get('/email-log', wrap(async (req, res) => res.json(await q(`SELECT id, identity, from_name, from_email, to_email, subject, attachments, status, provider_id, error, job_id, created_at FROM email_log WHERE user_id=$1 ORDER BY id DESC LIMIT 200`, [req.userId]))));

// ---------- Integrations (status only — secrets never leave the server) ----------
automation.get('/integrations', wrap(async (req, res) => {
  const force = req.query.refresh === '1';
  const [notif, app] = await Promise.all([identityStatus('notifications', force), identityStatus('job_application', force)]);
  const ai = aiStatus();
  res.json({
    ai: { enabled: ai.enabled, provider: ai.provider, models: ai.models, missing: ai.enabled ? [] : ['AI_PROVIDER', 'AI_API_KEY'] },
    resend: { apiKeySet: !!config.resend.apiKey, notifications: notif, jobApplication: app },
    whatsapp: whatsappStatus(),
    appBaseUrl: config.appBaseUrl,
    setupGuide: [
      'Sign in at resend.com and open Domains → Add domain → alawiyemuritala.xyz.',
      'Add the DNS records Resend shows (SPF/DKIM TXT and MX for the "send" subdomain) at your DNS host, then click Verify. Wait until the status is "Verified".',
      'API Keys → Create API key with "Full access" (needed so CareerPilot can confirm the domain is verified before sending). Copy it once.',
      'Put it in the server .env as RESEND_API_KEY=… (never in the frontend or Git).',
      'Set RESEND_FROM_EMAIL=notifications@alawiyemuritala.xyz and RESEND_FROM_NAME=CareerPilot AI for alerts to you.',
      'Set JOB_APPLICATION_FROM_EMAIL=me@alawiyemuritala.xyz and JOB_APPLICATION_FROM_NAME=Alawiye Muritala Adeshina for applications to employers.',
      'Make sure replies to me@alawiyemuritala.xyz reach a real inbox (Resend only sends; your mailbox provider receives).',
      'Restart the server, then press "Re-check" here and "Send test notification". Email applications stay off until you enable them in Automation.',
    ],
  });
}));
/** Sends a test alert to YOUR notification inbox only. Never to an employer. */
automation.post('/integrations/test-notification', wrap(async (req, res) => {
  const s = await getAutomation(req.userId!);
  const to = s.notification_email || config.notificationEmail;
  const r = await sendEmail({ identity: 'notifications', to, subject: 'CareerPilot AI test notification', text: `This is a test from CareerPilot AI. If you can read this, job alerts will reach ${to}.`, userId: req.userId });
  res.json({ ok: r.ok, status: r.status, error: r.error, from: r.from, to });
}));

// ---------- Professional evidence ----------
automation.get('/evidence', wrap(async (req, res) => {
  const s = await evidenceSummary(req.userId!);
  const p = await loadProfile(req.userId!);
  res.json({ ...s, issues: p.evidence?.issues ?? [], rule: 'Only verified and user-confirmed information is presented as fact in your documents.' });
}));
automation.post('/evidence', wrap(async (req, res) => {
  const b = z.object({ entity_type: z.enum(['experience', 'project', 'skill', 'profile', 'education']), entity_key: z.string().min(1), field: z.string().min(1), value: z.string().min(1).max(2000), source_url: z.string().url().nullable().optional(), note: z.string().nullable().optional() }).parse(req.body);
  res.json(await addClaim(req.userId!, b));
}));
automation.put('/evidence/:id', wrap(async (req, res) => res.json(await updateClaim(req.userId!, Number(req.params.id), z.object({ value: z.string().min(1).max(2000) }).parse(req.body).value))));
automation.post('/evidence/:id/confirm', wrap(async (req, res) => res.json(await confirmClaim(req.userId!, Number(req.params.id)))));
automation.post('/evidence/:id/reject', wrap(async (req, res) => res.json(await rejectClaim(req.userId!, Number(req.params.id)))));
automation.post('/evidence/conflicts/:group/resolve', wrap(async (req, res) => {
  const b = z.object({ keepId: z.number().int(), correctedValue: z.string().min(1).max(500).optional() }).parse(req.body);
  res.json(await resolveConflict(req.userId!, req.params.group as string, b.keepId, b.correctedValue));
}));
automation.get('/profile/suggestions', wrap(async (req, res) => res.json(await q(`SELECT * FROM profile_suggestions WHERE user_id=$1 AND status='pending' ORDER BY id DESC`, [req.userId]))));

/** CV upload: { filename, contentBase64 } for PDF/DOCX, or { filename, text }. Produces indicated claims + conflicts, never overwrites. */
automation.post('/evidence/cv-upload', wrap(async (req, res) => {
  const b = z.object({ filename: z.string().min(1).max(200), contentBase64: z.string().max(14_000_000).optional(), text: z.string().max(200_000).optional() }).parse(req.body);
  let text = b.text ?? '';
  if (!text && b.contentBase64) {
    const buf = Buffer.from(b.contentBase64, 'base64');
    if (/\.pdf$/i.test(b.filename) || buf.subarray(0, 4).toString() === '%PDF') {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js' as any)).default;
      text = (await pdfParse(buf)).text;
    } else if (/\.docx$/i.test(b.filename)) text = docxText(buf);
    else return res.status(400).json({ error: 'Upload a PDF or DOCX, or paste the text.' });
  }
  if (text.trim().length < 50) return res.status(422).json({ error: 'No readable text found in this file (it may be a scanned image). Paste the CV text instead.' });
  res.json(await ingestCvText(req.userId!, b.filename, text));
}));

/** Minimal DOCX reader: find word/document.xml in the zip and strip tags. */
function docxText(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a valid DOCX file');
  const count = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(off + 10); const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28); const elen = buf.readUInt16LE(off + 30); const clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42); const name = buf.subarray(off + 46, off + 46 + nlen).toString();
    if (name === 'word/document.xml') {
      const lstart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(lstart, lstart + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }
    off += 46 + nlen + elen + clen;
  }
  throw new Error('DOCX has no document body');
}
