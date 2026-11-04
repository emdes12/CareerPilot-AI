import { json, one, q } from '../db.js';

/**
 * Deterministic automation policy. Scores are profile-match scores, NOT hiring probabilities.
 * Every check is returned (pass/fail + reason) and stored with each application attempt for audit.
 */
/** Lowest auto-apply minimum the user may choose (owner's decision, 2026-11-04). */
export const AUTO_APPLY_FLOOR = 75;

export type Tier = 'priority' | 'strong' | 'good' | 'possible' | 'store';
export const TIERS: { tier: Tier; min: number; label: string; action: string }[] = [
  { tier: 'priority', min: 90, label: 'Priority match (90–100)', action: 'Deeper research, re-verify open + Nigeria eligibility, prepare documents, auto-submit only if you enabled it' },
  { tier: 'strong', min: 80, label: 'Strong match (80–89)', action: 'Prepare documents and notify you; you approve or apply yourself' },
  { tier: 'good', min: 70, label: 'Good match (70–79)', action: 'Prepare documents where worthwhile and notify you' },
  { tier: 'possible', min: 50, label: 'Possible match (50–69)', action: 'Notification only' },
  { tier: 'store', min: 0, label: 'Below 50', action: 'Stored for analytics only' },
];
export const tierFor = (score: number): Tier => TIERS.find((t) => score >= t.min)!.tier;

export interface AutomationSettings {
  user_id: number; auto_apply_enabled: boolean; auto_apply_min_score: number; require_approval: boolean;
  allow_email_applications: boolean; allow_portal_applications: boolean; max_applications_per_day: number;
  excluded_companies: string[]; excluded_keywords: string[]; paused: boolean;
  notify_email_enabled: boolean; notify_whatsapp_enabled: boolean; notification_email: string | null; whatsapp_to: string | null;
  notify_min_score: number; docs_min_score: number; updated_at: string; updated_by: string | null;
}

export async function getAutomation(userId: number): Promise<AutomationSettings> {
  await q(`INSERT INTO automation_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  return (await one<AutomationSettings>('SELECT * FROM automation_settings WHERE user_id=$1', [userId]))!;
}

const FIELDS = ['auto_apply_enabled', 'auto_apply_min_score', 'require_approval', 'allow_email_applications', 'allow_portal_applications', 'max_applications_per_day',
  'excluded_companies', 'excluded_keywords', 'paused', 'notify_email_enabled', 'notify_whatsapp_enabled', 'notification_email', 'whatsapp_to', 'notify_min_score', 'docs_min_score'] as const;

/** Only explicit user requests change automation settings; each change is logged as an event. */
export async function updateAutomation(userId: number, patch: Partial<AutomationSettings>) {
  const before = await getAutomation(userId);
  const keys = FIELDS.filter((k) => k in patch);
  if (!keys.length) return before;
  if ((patch.auto_apply_min_score ?? AUTO_APPLY_FLOOR) < AUTO_APPLY_FLOOR) throw new Error(`Auto-apply minimum score must be at least ${AUTO_APPLY_FLOOR}.`);
  const vals = keys.map((k) => (Array.isArray(patch[k]) ? json(patch[k]) : patch[k]));
  const after = await one<AutomationSettings>(`UPDATE automation_settings SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now(), updated_by='user' WHERE user_id=$1 RETURNING *`, [userId, ...vals]);
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after![k])).map((k) => ({ field: k, from: before[k], to: after![k] }));
  if (changed.length) await q(`INSERT INTO settings_audit (user_id, changes) VALUES ($1,$2)`, [userId, json(changed)]);
  return after!;
}

export async function recordEvent(userId: number, jobId: number, type: string, message: string, actor: string, data: unknown = {}) {
  await q(`INSERT INTO application_events (user_id, job_id, type, message, actor, data) VALUES ($1,$2,$3,$4,$5,$6)`, [userId, jobId, type, message, actor, json(data)]);
}

export interface Check { check: string; ok: boolean; detail: string }

/**
 * Decide whether an application may be submitted automatically (or on the user's request) for a job.
 * requestedBy 'user' = the user pressed "Approve & send" for this one job (counts as approval).
 */
export async function evaluateSubmission(userId: number, jobId: number, requestedBy: 'auto' | 'user') {
  const s = await getAutomation(userId);
  const job = await one(`SELECT j.*, a.total_score, a.eligibility, a.actionable FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id WHERE j.id=$1 AND j.user_id=$2`, [jobId, userId]);
  if (!job) throw new Error('Job not found');
  const app = await one(`SELECT * FROM applications WHERE job_id=$1`, [jobId]);
  const research = await one(`SELECT * FROM job_research WHERE job_id=$1`, [jobId]);
  const docs = await q(`SELECT DISTINCT ON (kind) id, kind, qa FROM documents WHERE job_id=$1 AND user_id=$2 ORDER BY kind, version DESC`, [jobId, userId]);
  const today = await one<{ n: number }>(`SELECT count(*)::int n FROM application_attempts WHERE user_id=$1 AND status='submitted' AND created_at > now() - interval '24 hours'`, [userId]);
  const prior = await one(`SELECT id, status, created_at FROM application_attempts WHERE job_id=$1 AND status='submitted' LIMIT 1`, [jobId]);
  const score = Number(job.total_score ?? 0);
  const elig = job.eligibility?.status ?? 'unknown';
  const verifiedRecently = job.last_verified_open_at && Date.now() - new Date(job.last_verified_open_at).getTime() < 36 * 3600e3;
  const hay = `${job.title} ${job.company_name}`.toLowerCase();
  const cv = docs.find((d: any) => d.kind === 'cv'); const cl = docs.find((d: any) => d.kind === 'cover_letter'); const ans = docs.find((d: any) => d.kind === 'answers');

  const checks: Check[] = [
    { check: 'Automation not paused', ok: !s.paused, detail: s.paused ? 'All automation is paused' : 'Active' },
    ...(requestedBy === 'auto' ? [
      { check: 'Auto-apply enabled by you', ok: s.auto_apply_enabled, detail: s.auto_apply_enabled ? 'Enabled' : 'Auto-apply is off (default). Enable it in Automation settings.' },
      { check: `Score ≥ ${s.auto_apply_min_score}`, ok: score >= s.auto_apply_min_score, detail: `Match score ${score}` },
      { check: 'Approval not required', ok: !s.require_approval || app?.approval_status === 'approved', detail: s.require_approval ? (app?.approval_status === 'approved' ? 'Approved by you' : 'Your approval is required for each application') : 'Approval not required by your settings' },
    ] : [
      { check: 'Approved by you', ok: true, detail: 'You requested this submission' },
    ]),
    { check: 'Nigeria eligibility confirmed', ok: elig === 'eligible', detail: `Eligibility: ${elig}${job.eligibility?.evidence?.[0] ? ` — “${job.eligibility.evidence[0]}”` : ''}` },
    { check: 'Vacancy active', ok: job.status === 'active', detail: `Status: ${job.status}` },
    { check: 'Verified open in the last 36h', ok: !!verifiedRecently, detail: job.last_verified_open_at ? `Last verified ${new Date(job.last_verified_open_at).toISOString()}` : 'Not yet verified open' },
    { check: 'Not a repost of an expired listing', ok: !job.is_repost, detail: job.is_repost ? 'Listing is a repost — confirm it is genuinely open' : 'OK' },
    { check: 'Company not excluded', ok: !s.excluded_companies.some((c) => hay.includes(c.toLowerCase())), detail: 'Exclusion list checked' },
    { check: 'No excluded keyword', ok: !s.excluded_keywords.some((k) => hay.includes(k.toLowerCase())), detail: 'Keyword exclusions checked' },
    { check: `Daily limit (${s.max_applications_per_day})`, ok: (today?.n ?? 0) < s.max_applications_per_day, detail: `${today?.n ?? 0} submitted in the last 24h` },
    { check: 'Not already submitted', ok: !prior, detail: prior ? `Already submitted (attempt #${prior.id})` : 'No previous submission' },
    { check: 'CV passed QA', ok: !!cv?.qa?.submittable, detail: !cv ? 'No tailored CV' : cv.qa?.submittable ? 'Passed' : `Not submittable: ${[...(cv.qa?.errors ?? []), ...(cv.qa?.warnings ?? []).filter((w: string) => /need your input|Unresolved/.test(w))].slice(0, 2).join('; ') || 'not checked'}` },
    { check: 'Cover letter passed QA', ok: !!cl?.qa?.submittable, detail: !cl ? 'No cover letter' : cl.qa?.submittable ? 'Passed' : `Not submittable: ${[...(cl.qa?.errors ?? []), ...(cl.qa?.warnings ?? []).filter((w: string) => /need your input|Unresolved/.test(w))].slice(0, 2).join('; ') || 'not checked'}` },
    { check: 'Required answers complete', ok: !ans || !(ans.qa?.warnings ?? []).some((w: string) => /need your input/.test(w)) || !(research?.screening_questions ?? []).some((x: any) => x.required), detail: 'Required screening answers have no placeholders' },
  ];
  // Channel: email only to an address explicitly published in the listing; otherwise the official portal.
  const channel: 'email' | 'portal' | 'none' = research?.apply_method === 'email' && research?.apply_email ? 'email' : research?.official_url ? 'portal' : 'none';
  checks.push(channel === 'email'
    ? { check: 'Email applications allowed', ok: s.allow_email_applications, detail: s.allow_email_applications ? `To ${research.apply_email} (published in the listing)` : 'Email applications are off in your settings' }
    : channel === 'portal'
      ? { check: 'Portal applications allowed', ok: s.allow_portal_applications, detail: s.allow_portal_applications ? 'Allowed' : 'Portal applications are off in your settings' }
      : { check: 'Application destination known', ok: false, detail: 'No verified application destination' });
  const failed = checks.filter((c) => !c.ok);
  return { allowed: failed.length === 0, checks, failed, channel, job, research, docs, settings: s, score, tier: tierFor(score) };
}
