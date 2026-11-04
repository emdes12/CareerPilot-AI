import { config } from '../config.js';
import { json, q } from '../db.js';

/**
 * Resend email provider (https://resend.com/docs/api-reference) with TWO separate sender identities:
 *  - 'notifications'   → "CareerPilot AI <notifications@…>", only ever to the owner's notification address.
 *  - 'job_application' → "Alawiye Muritala Adeshina <me@…>", only for application emails to employers.
 * Each identity is validated independently (env vars present + sending domain VERIFIED in Resend).
 * There is no fallback between them: an unconfigured identity means the email is not sent.
 * The API key lives only in backend env vars; it is never returned to the frontend or logged.
 */
export type Identity = 'notifications' | 'job_application';

export interface IdentityStatus {
  identity: Identity; configured: boolean; missing: string[];
  fromName: string | null; fromEmail: string | null; senderDomain: string | null;
  domainVerified: boolean | null; detail: string;
}

const ENV = {
  notifications: { email: 'RESEND_FROM_EMAIL', name: 'RESEND_FROM_NAME' },
  job_application: { email: 'JOB_APPLICATION_FROM_EMAIL', name: 'JOB_APPLICATION_FROM_NAME' },
} as const;

function identityConfig(id: Identity) {
  return id === 'notifications'
    ? { fromEmail: config.resend.fromEmail, fromName: config.resend.fromName, replyTo: config.resend.replyTo }
    : { fromEmail: config.jobApplication.fromEmail, fromName: config.jobApplication.fromName, replyTo: config.jobApplication.replyTo };
}

let domainCache: { at: number; ok: boolean; domains: { name: string; status: string }[]; error: string | null } | null = null;

async function listDomains(force: boolean) {
  if (!force && domainCache && Date.now() - domainCache.at < 10 * 60 * 1000) return domainCache;
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${config.resend.apiKey}` } });
    const d: any = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) domainCache = { at: Date.now(), ok: false, domains: [], error: 'Resend rejected the API key, or it is a "sending access" key that cannot read domains. Create a key with "Full access" so the domain can be verified before sending.' };
    else if (!res.ok) domainCache = { at: Date.now(), ok: false, domains: [], error: `Resend API error HTTP ${res.status}` };
    else domainCache = { at: Date.now(), ok: true, domains: (d.data ?? []).map((x: any) => ({ name: String(x.name).toLowerCase(), status: x.status })), error: null };
  } catch (e) { domainCache = { at: Date.now(), ok: false, domains: [], error: `Could not reach Resend: ${(e as Error).message}` }; }
  return domainCache;
}

export async function identityStatus(id: Identity, force = false): Promise<IdentityStatus> {
  const c = identityConfig(id);
  const missing = [!config.resend.apiKey && 'RESEND_API_KEY', !c.fromEmail && ENV[id].email, !c.fromName && ENV[id].name].filter(Boolean) as string[];
  const senderDomain = c.fromEmail.split('@')[1]?.toLowerCase() ?? null;
  const base = { identity: id, fromName: c.fromName || null, fromEmail: c.fromEmail || null, senderDomain };
  if (missing.length) return { ...base, configured: false, missing, domainVerified: null, detail: `Missing ${missing.join(', ')}` };
  if (id === 'job_application' && /careerpilot/i.test(c.fromName)) return { ...base, configured: false, missing: [], domainVerified: null, detail: 'JOB_APPLICATION_FROM_NAME must be your own name, not "CareerPilot AI".' };
  if (id === 'job_application' && c.fromEmail.toLowerCase() === config.resend.fromEmail.toLowerCase()) return { ...base, configured: false, missing: [], domainVerified: null, detail: 'JOB_APPLICATION_FROM_EMAIL must differ from the notifications sender.' };
  const d = await listDomains(force);
  if (!d.ok) return { ...base, configured: false, missing: [], domainVerified: null, detail: d.error! };
  const dom = d.domains.find((x) => x.name === senderDomain);
  const verified = dom?.status === 'verified';
  return { ...base, configured: verified, missing: [], domainVerified: verified,
    detail: !dom ? `Domain ${senderDomain} is not added to your Resend account` : verified ? `Domain ${senderDomain} verified — sends as "${c.fromName} <${c.fromEmail}>"` : `Domain ${senderDomain} status "${dom.status}" — finish DNS verification in Resend` };
}

/** Back-compat: status of the notifications identity. */
export const resendStatus = (force = false) => identityStatus('notifications', force);

export interface SendInput {
  identity: Identity; to: string | string[]; cc?: string[]; bcc?: string[]; subject: string; html?: string; text: string; replyTo?: string;
  attachments?: { filename: string; content: Buffer }[]; idempotencyKey?: string; userId?: number | null; jobId?: number | null;
  /** 'manual' = written by the user in the composer. */
  kind?: 'system' | 'manual';
  /** Update this pre-reserved email_log row instead of inserting a new one (used for duplicate-send protection). */
  logId?: number;
}
const toList = (m: SendInput) => (Array.isArray(m.to) ? m.to : [m.to]);
export interface SendResult { ok: boolean; id: string | null; status: 'accepted' | 'not_configured' | 'rejected' | 'error'; error: string | null; from: string | null; providerResponse: unknown; logId: number | null }

export async function sendEmail(m: SendInput): Promise<SendResult> {
  const st = await identityStatus(m.identity);
  const c = identityConfig(m.identity);
  const from = st.fromEmail ? `${c.fromName} <${c.fromEmail}>` : null;
  // Notifications identity may only ever reach the owner's notification inbox.
  const ownInbox = m.userId ? (await q<{ e: string | null }>(`SELECT notification_email e FROM automation_settings WHERE user_id=$1`, [m.userId]))[0]?.e : null;
  const allowedTo = [config.notificationEmail, ownInbox].filter(Boolean).map((x) => x!.toLowerCase());
  if (m.identity === 'notifications' && [...toList(m), ...(m.cc ?? []), ...(m.bcc ?? [])].some((x) => !allowedTo.includes(x.toLowerCase())))
    return logged(m, from, { ok: false, id: null, status: 'rejected', error: 'The notifications sender may only email your own notification address', providerResponse: null });
  if (!st.configured) return logged(m, from, { ok: false, id: null, status: 'not_configured', error: st.detail, providerResponse: null });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resend.apiKey}`, 'content-type': 'application/json', ...(m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey } : {}) },
      body: JSON.stringify({
        from, to: toList(m), cc: m.cc?.length ? m.cc : undefined, bcc: m.bcc?.length ? m.bcc : undefined, subject: m.subject, text: m.text, html: m.html,
        reply_to: m.replyTo || c.replyTo || undefined,
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
      }),
    });
    const d: any = await res.json().catch(() => ({}));
    if (res.ok && d.id) return logged(m, from, { ok: true, id: d.id, status: 'accepted', error: null, providerResponse: { id: d.id } });
    return logged(m, from, { ok: false, id: null, status: 'rejected', error: d?.message ?? `HTTP ${res.status}`, providerResponse: { status: res.status, name: d?.name, message: d?.message } });
  } catch (e) { return logged(m, from, { ok: false, id: null, status: 'error', error: (e as Error).message, providerResponse: null }); }
}

async function logged(m: SendInput, from: string | null, r: Omit<SendResult, 'from' | 'logId'>): Promise<SendResult> {
  let logId: number | null = m.logId ?? null;
  const c = identityConfig(m.identity);
  const atts = json((m.attachments ?? []).map((a) => ({ filename: a.filename, bytes: a.content.length })));
  try {
    if (m.logId) {
      await q(`UPDATE email_log SET from_name=$2, from_email=$3, attachments=$4, status=$5, provider_id=$6, error=$7, updated_at=now() WHERE id=$1`,
        [m.logId, c.fromName || null, c.fromEmail || null, atts, r.status, r.id, r.error]);
      return { ...r, from, logId };
    }
    const rows = await q<{ id: number }>(`INSERT INTO email_log (user_id, identity, from_name, from_email, to_email, subject, attachments, status, provider_id, error, job_id, kind, to_list, cc, bcc, body_html, body_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [m.userId ?? null, m.identity, c.fromName || null, c.fromEmail || null, toList(m).join(', '), m.subject, atts, r.status, r.id, r.error, m.jobId ?? null,
        m.kind ?? 'system', json(toList(m)), json(m.cc ?? []), json(m.bcc ?? []), m.html ?? null, m.text]);
    logId = rows[0]?.id ?? null;
  } catch (e) { console.error('[email_log]', (e as Error).message); }
  return { ...r, from, logId };
}

/** Ask Resend for the latest delivery event of a sent email (sent/delivered/bounced/...), and update the log. */
export async function emailLastEvent(id: string): Promise<string | null> {
  if (!config.resend.apiKey) return null;
  try {
    const r = await fetch(`https://api.resend.com/emails/${id}`, { headers: { authorization: `Bearer ${config.resend.apiKey}` } });
    if (!r.ok) return null;
    const ev = ((await r.json()) as any).last_event ?? null;
    await q(`UPDATE email_log SET status=COALESCE($2, status), status_checked_at=now(), updated_at=now() WHERE provider_id=$1`, [id, ev]);
    return ev;
  } catch { return null; }
}
