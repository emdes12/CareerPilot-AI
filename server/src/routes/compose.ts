import { Router, type Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import type { AuthedRequest } from '../auth.js';
import { one, q } from '../db.js';
import { cvDocx, cvPdf, letterDocx, letterPdf } from '../docs/render.js';
import { emailLastEvent, identityStatus, sendEmail } from '../integrations/resend.js';

/**
 * Manual email composer. Always sends as the job-application identity
 * ("Alawiye Muritala Adeshina <me@…>") through the existing Resend integration — never the notifications sender.
 * Nothing here sends on its own: every message is an explicit user action.
 */
export const compose = Router();
type R = AuthedRequest;
const wrap = (fn: (req: R, res: Response) => Promise<unknown>) => (req: R, res: Response) => fn(req, res).catch((e) => {
  if (!(e instanceof z.ZodError) && !e.status) console.error(e);
  res.status(e instanceof z.ZodError ? 400 : e.status ?? 500).json({ error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') : e.message });
});
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// ---------- Attachment rules ----------
export const ATTACH = {
  maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024, maxFiles: 10,
  // extension → check on the file's first bytes, so a renamed executable can't slip through.
  types: {
    pdf: (b: Buffer) => b.subarray(0, 4).toString('latin1') === '%PDF',
    docx: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b, odt: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b,
    doc: (b: Buffer) => b.subarray(0, 4).toString('hex') === 'd0cf11e0',
    rtf: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '{\\rtf',
    txt: (b: Buffer) => !b.includes(0), md: (b: Buffer) => !b.includes(0), csv: (b: Buffer) => !b.includes(0),
    png: (b: Buffer) => b.subarray(0, 4).toString('hex') === '89504e47',
    jpg: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8, jpeg: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8,
  } as Record<string, (b: Buffer) => boolean>,
};
const cleanName = (n: string) => n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'attachment';

// ---------- Body sanitising: only formatting a normal email needs ----------
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'mark', 'span', 'blockquote', 'hr', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'target', 'rel'], mark: ['style', 'data-color'], span: ['style'], p: ['style'], h1: ['style'], h2: ['style'], h3: ['style'] },
  allowedStyles: { '*': { color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i], 'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i], 'text-align': [/^(left|right|center|justify)$/] } },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
};
const toText = (html: string) => sanitizeHtml(html.replace(/<\/(p|h[1-3]|li|blockquote)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<li>/gi, '• '), { allowedTags: [], allowedAttributes: {} })
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
/** Wrap the body in a minimal, email-client-friendly shell. */
const emailHtml = (body: string) => `<!doctype html><html><body style="margin:0;padding:0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;max-width:680px">${body}</div></body></html>`;

const email = z.string().trim().toLowerCase().email('is not a valid email address');
const SendBody = z.object({
  clientKey: z.string().min(8).max(80),
  to: z.array(email).min(1, 'add at least one recipient').max(10),
  cc: z.array(email).max(10).default([]),
  bcc: z.array(email).max(10).default([]),
  subject: z.string().trim().min(1, 'is required').max(250),
  html: z.string().max(500_000),
  jobId: z.number().int().positive().nullable().optional(),
  files: z.array(z.object({ filename: z.string().min(1).max(200), contentBase64: z.string() })).max(ATTACH.maxFiles).default([]),
  documents: z.array(z.object({ id: z.number().int().positive(), format: z.enum(['pdf', 'docx']) })).max(6).default([]),
});

// ---------- Sender status (the composer shows this before you write) ----------
compose.get('/compose/status', wrap(async (req, res) => {
  const st = await identityStatus('job_application', req.query.refresh === '1');
  res.json({ ready: st.configured, fromName: st.fromName, fromEmail: st.fromEmail, detail: st.detail, missing: st.missing, limits: { maxFileMb: ATTACH.maxFileBytes / 1048576, maxTotalMb: ATTACH.maxTotalBytes / 1048576, maxFiles: ATTACH.maxFiles, types: Object.keys(ATTACH.types) } });
}));

// ---------- Job context for prefilling (suggestions only; the user decides) ----------
compose.get('/compose/context', wrap(async (req, res) => {
  const jobId = z.coerce.number().int().positive().parse(req.query.jobId);
  const job = await one(`SELECT j.id, j.title, j.company_name, r.apply_email, r.apply_method, r.official_url FROM jobs j LEFT JOIN job_research r ON r.job_id=j.id WHERE j.id=$1 AND j.user_id=$2`, [jobId, req.userId]);
  if (!job) throw fail(404, 'Job not found');
  const docs = await q<any>(`SELECT DISTINCT ON (kind) id, kind, version, content, qa, created_at FROM documents WHERE job_id=$1 AND user_id=$2 AND kind IN ('cv','cover_letter','email') ORDER BY kind, version DESC`, [jobId, req.userId]);
  const mail = docs.find((d) => d.kind === 'email');
  const p = await one<any>('SELECT full_name FROM profiles WHERE user_id=$1', [req.userId]);
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const draftHtml = mail?.content?.body ? String(mail.content.body).split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('') : null;
  res.json({
    job: { id: job.id, title: job.title, company: job.company_name, officialUrl: job.official_url, applyMethod: job.apply_method },
    // Only an address published in the listing itself (found by the research step) — never a guessed one.
    recipient: job.apply_email ? { email: job.apply_email, source: 'Published in the job listing' } : null,
    subject: mail?.content?.subject ?? `Application: ${job.title} — ${p?.full_name ?? ''}`.trim(),
    draftHtml,
    documents: docs.filter((d) => d.kind !== 'email').map((d) => ({ id: d.id, kind: d.kind, version: d.version, label: d.kind === 'cv' ? `Tailored CV (v${d.version})` : `Cover letter (v${d.version})`, qaSubmittable: d.qa?.submittable ?? null })),
  });
}));

/** Generated documents the composer can attach without download/re-upload (rendered server-side; never exposed by URL). */
compose.get('/compose/documents', wrap(async (req, res) => {
  res.json(await q(`SELECT d.id, d.kind, d.version, d.title, d.job_id, d.created_at, j.title AS job_title, j.company_name FROM documents d LEFT JOIN jobs j ON j.id=d.job_id
    WHERE d.user_id=$1 AND d.kind IN ('cv','cover_letter') ORDER BY d.created_at DESC LIMIT 40`, [req.userId]));
}));

async function renderDoc(userId: number, id: number, format: 'pdf' | 'docx') {
  const d = await one<any>('SELECT * FROM documents WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!d || !['cv', 'cover_letter'].includes(d.kind)) throw fail(400, `Document ${id} can't be attached`);
  const p = await one<any>('SELECT full_name, email, phone, links FROM profiles WHERE user_id=$1', [userId]);
  const company = (d.content?.meta?.company || d.title.split('@')[1] || 'master').trim().replace(/[^\w]+/g, '_');
  const filename = `${p.full_name.replace(/\s+/g, '_')}_${d.kind === 'cv' ? 'CV' : 'Cover_Letter'}_${company}.${format}`;
  const contact = [p.email, p.phone, p.links?.portfolio].filter(Boolean).join(' · ');
  const content = d.kind === 'cv' ? (format === 'docx' ? await cvDocx(d.content) : await cvPdf(d.content))
    : (format === 'docx' ? await letterDocx(p.full_name, contact, d.content) : await letterPdf(p.full_name, contact, d.content));
  return { filename, content };
}

// ---------- Send ----------
compose.post('/compose/send', wrap(async (req, res) => {
  const b = SendBody.parse(req.body);
  const all = [...b.to, ...b.cc, ...b.bcc];
  if (new Set(all).size !== all.length) throw fail(400, 'The same address appears more than once across To, CC and BCC');
  const html = sanitizeHtml(b.html, SANITIZE).trim();
  const text = toText(html);
  if (!text) throw fail(400, 'Message: write something before sending');
  if (b.jobId) { const j = await one('SELECT id FROM jobs WHERE id=$1 AND user_id=$2', [b.jobId, req.userId]); if (!j) throw fail(404, 'Job not found'); }

  // Attachments: validate type by extension AND file signature, plus size limits.
  const attachments: { filename: string; content: Buffer }[] = [];
  for (const f of b.files) {
    const filename = cleanName(f.filename);
    const ext = filename.split('.').pop()!.toLowerCase();
    const check = ATTACH.types[ext];
    if (!check) throw fail(400, `${filename}: .${ext} files can't be attached (allowed: ${Object.keys(ATTACH.types).join(', ')})`);
    const content = Buffer.from(f.contentBase64, 'base64');
    if (!content.length) throw fail(400, `${filename} is empty`);
    if (content.length > ATTACH.maxFileBytes) throw fail(400, `${filename} is larger than ${ATTACH.maxFileBytes / 1048576} MB`);
    if (!check(content)) throw fail(400, `${filename} doesn't look like a real .${ext} file`);
    attachments.push({ filename, content });
  }
  for (const d of b.documents) attachments.push(await renderDoc(req.userId!, d.id, d.format));
  const total = attachments.reduce((n, a) => n + a.content.length, 0);
  if (total > ATTACH.maxTotalBytes) throw fail(400, `Attachments total ${(total / 1048576).toFixed(1)} MB; the limit is ${ATTACH.maxTotalBytes / 1048576} MB`);

  // Sender must be configured and verified; never fall back to the notifications sender.
  const st = await identityStatus('job_application');
  if (!st.configured) throw fail(503, `Email sending isn't set up: ${st.detail}. Nothing was sent.`);

  // Reserve this draft's key first: a double click or retry can never send twice.
  const reserved = await q<{ id: number }>(`INSERT INTO email_log (user_id, identity, kind, from_name, from_email, to_email, to_list, cc, bcc, subject, body_html, body_text, attachments, status, job_id, client_key)
    VALUES ($1,'job_application','manual',$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,'sending',$11,$12) ON CONFLICT (user_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,
    [req.userId, st.fromName, st.fromEmail, b.to.join(', '), JSON.stringify(b.to), JSON.stringify(b.cc), JSON.stringify(b.bcc), b.subject, html, text, b.jobId ?? null, b.clientKey]);
  if (!reserved.length) {
    const prev = await one<any>(`SELECT id, status, provider_id FROM email_log WHERE user_id=$1 AND client_key=$2`, [req.userId, b.clientKey]);
    throw fail(409, prev?.status === 'sending' ? 'This email is already being sent' : `This email was already sent (status: ${prev?.status}). Nothing was sent again.`);
  }
  const r = await sendEmail({ identity: 'job_application', kind: 'manual', to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: emailHtml(html), text, attachments, idempotencyKey: b.clientKey, userId: req.userId, jobId: b.jobId ?? null, logId: reserved[0].id });
  if (!r.ok) {
    // A failed attempt frees the draft key so the user can fix the problem and press Send again.
    await q(`UPDATE email_log SET client_key=NULL WHERE id=$1`, [reserved[0].id]);
    throw fail(r.status === 'not_configured' ? 503 : 502, `Not sent — ${r.error ?? 'the email provider refused it'}`);
  }
  res.json({ ok: true, id: r.logId, providerId: r.id, status: r.status, from: r.from, attachments: attachments.map((a) => ({ filename: a.filename, bytes: a.content.length })) });
}));

// ---------- History ----------
compose.get('/emails', wrap(async (req, res) => {
  const kind = req.query.kind === 'all' ? null : 'manual';
  res.json(await q(`SELECT id, kind, identity, from_name, from_email, to_list, to_email, cc, bcc, subject, attachments, status, provider_id, error, job_id, created_at, status_checked_at
    FROM email_log WHERE user_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY id DESC LIMIT 200`, [req.userId, kind]));
}));
compose.get('/emails/:id', wrap(async (req, res) => {
  const e = await one(`SELECT l.*, j.title AS job_title, j.company_name FROM email_log l LEFT JOIN jobs j ON j.id=l.job_id WHERE l.id=$1 AND l.user_id=$2`, [Number(req.params.id), req.userId]);
  if (!e) throw fail(404, 'Email not found');
  delete (e as any).client_key;
  res.json(e);
}));
/** Ask Resend for the latest delivery event (delivered / bounced / …). Acceptance alone is not proof of delivery. */
compose.post('/emails/:id/refresh', wrap(async (req, res) => {
  const e = await one<any>(`SELECT provider_id FROM email_log WHERE id=$1 AND user_id=$2`, [Number(req.params.id), req.userId]);
  if (!e) throw fail(404, 'Email not found');
  if (!e.provider_id) return res.json({ status: null, note: 'This email never reached the provider, so there is no delivery status.' });
  const ev = await emailLastEvent(e.provider_id);
  res.json({ status: ev, note: ev ? null : 'The provider has no newer status yet.' });
}));
