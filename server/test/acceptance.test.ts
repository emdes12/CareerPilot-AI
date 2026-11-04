/**
 * Acceptance tests for freshness, evidence, human-written documents, QA, automation policy and the two
 * Resend sender identities. They use the real local database (owner account + real seeded evidence) and create
 * only temporary rows that are deleted afterwards. No email is ever sent: every send path under test stops
 * before the network (identity not configured, or recipient not allowed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { one, pool, q } from '../src/db.js';
import { buildCoverLetter, buildCv } from '../src/docs/generate.js';
import { qaDocument } from '../src/docs/qa.js';
import { BANNED_PHRASES } from '../src/docs/style.js';
import { applyEvidence, type Claim } from '../src/engine/evidence.js';
import { computeFreshness } from '../src/engine/freshness.js';
import { evaluateSubmission, tierFor } from '../src/engine/policy.js';
import { loadProfile, type FullProfile } from '../src/engine/profile.js';
import { matchRequirement, scoreJob } from '../src/engine/scoring.js';
import { identityStatus, sendEmail } from '../src/integrations/resend.js';
import { sendWhatsApp } from '../src/integrations/whatsapp.js';

let userId: number; let p: FullProfile;
const tmpJobs: number[] = [];
const DAY = 864e5;

async function tmpJob(fields: Record<string, unknown>) {
  const base = { source: 'remotive', source_job_id: `test-${Date.now()}-${Math.random()}`, source_url: 'https://example.com/job', title: 'Full-Stack Engineer', company_name: 'TestCo Acceptance', fingerprint: `test::${Math.random()}`, status: 'active', description_text: 'React, Node.js and PostgreSQL. Remote worldwide.' };
  const f = { ...base, ...fields };
  const keys = Object.keys(f);
  const r = await one<{ id: number }>(`INSERT INTO jobs (user_id, ${keys.join(',')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`, [userId, ...keys.map((k) => (f as any)[k])]);
  tmpJobs.push(r!.id);
  return r!.id;
}
const job = (overrides: any = {}) => ({
  id: 999999, title: 'Full-Stack Engineer', company_name: 'TestCo Acceptance', description_text: 'We use React, Node.js, PostgreSQL and AWS. Remote worldwide.',
  location_raw: 'Remote (Worldwide)', location_restrictions: [], source: 'remotive', seniority: null, salary_min: null, salary_max: null, salary_currency: null, salary_period: null, salary_raw: null,
  posted_at: new Date(), deadline: null, status: 'active', ...overrides,
});
const opts = { fx: { USD: 1500 }, minNgn: 500000, targetNgn: 1000000 };

beforeAll(async () => {
  userId = (await one<{ id: number }>('SELECT id FROM users ORDER BY id LIMIT 1'))!.id;
  p = await loadProfile(userId);
});
afterAll(async () => {
  if (tmpJobs.length) await q('DELETE FROM jobs WHERE id = ANY($1)', [tmpJobs]);
  await q(`DELETE FROM email_log WHERE subject LIKE 'ACCEPTANCE TEST%'`);
  await pool.end();
});

describe('1. Freshness ranking', () => {
  it('a job published today scores higher on freshness than the same job published 25 days ago', () => {
    const today = scoreJob(job({ posted_at: new Date() }), p, opts);
    const old = scoreJob(job({ posted_at: new Date(Date.now() - 25 * DAY) }), p, opts);
    const f = (a: any) => a.breakdown.find((b: any) => b.key === 'freshness').score;
    expect(f(today)).toBeGreaterThan(f(old));
    expect(today.total).toBeGreaterThanOrEqual(old.total);
  });
  it('jobs older than 30 days are kept out of recommendations unless verified open recently', () => {
    const stale = scoreJob(job({ posted_at: new Date(Date.now() - 45 * DAY) }), p, opts);
    expect(stale.total).toBeLessThanOrEqual(69);
    expect(stale.concerns.join(' ')).toMatch(/not verified open/);
  });
});

describe('2. Reposts are not labelled new', () => {
  it('a vacancy first seen 20 days ago and re-dated today by an aggregator keeps its original date', async () => {
    const fp = `test::repost::${Math.random()}`;
    await tmpJob({ fingerprint: fp, source: 'remoteok', posted_at: new Date(Date.now() - 20 * DAY), discovered_at: new Date(Date.now() - 20 * DAY) });
    const id = await tmpJob({ fingerprint: fp, source: 'jobicy', posted_at: new Date() });
    await computeFreshness(id);
    const j = await one('SELECT * FROM jobs WHERE id=$1', [id]);
    expect(j.is_repost).toBe(true);
    expect(Date.now() - new Date(j.effective_published_at).getTime()).toBeGreaterThan(19 * DAY);
    expect(j.publication_note).toMatch(/unverified/i);
    const a = scoreJob({ ...j, location_restrictions: [] }, p, opts);
    expect(a.breakdown.find((b: any) => b.key === 'freshness')!.reasons.join(' ')).toMatch(/Re-listed/);
  });
});

describe('3. Closed jobs are excluded from automatic submission', () => {
  it('evaluateSubmission fails the "Vacancy active" check for an expired job', async () => {
    const id = await tmpJob({ status: 'expired' });
    const ev = await evaluateSubmission(userId, id, 'auto');
    expect(ev.allowed).toBe(false);
    expect(ev.checks.find((c) => c.check === 'Vacancy active')!.ok).toBe(false);
    expect(ev.checks.find((c) => c.check === 'Auto-apply enabled by you')!.ok).toBe(false); // off by default
  });
});

describe('4–6. Evidence', () => {
  it('every CV experience bullet traces back to an evidence claim with a source', () => {
    const refs = p.evidence!.refs;
    const cv = buildCv(p, job(), []);
    for (const e of cv.experience) for (const b of e.bullets) {
      const ref = refs.find((r) => r.value === b);
      expect(ref, `untraced bullet: ${b}`).toBeTruthy();
      expect(['verified', 'user_confirmed']).toContain(ref!.status);
    }
  });
  it('a technology that appears only in the job description is not added to the CV', () => {
    expect(p.skillMap.has('aws')).toBe(false);
    const reqs = [{ skill: 'aws', label: 'AWS', importance: 'required' as const, mentions: 2 }].map((r) => matchRequirement(r, p));
    const cv = buildCv(p, job(), reqs);
    expect(JSON.stringify([cv.summary, cv.skills, cv.experience, cv.projects])).not.toMatch(/\bAWS\b/);
    expect(cv.meta.omittedSkills).toContain('AWS');
  });
  it('conflicting dates are flagged, not guessed', () => {
    const mk = (id: number, value: string, source: string): Claim => ({ id, entity_type: 'experience', entity_key: 'TestCo', field: 'dates', value, source_type: source, source_url: null, status: 'conflicting', conflict_group: 'testco-dates', note: null });
    const v = applyEvidence({ experiences: [{ company: 'TestCo', title: 'Engineer', start_date: null, end_date: null, is_current: false, bullets: [] }], projects: [] }, [mk(1, '2023-01|2024-01', 'portfolio'), mk(2, '2022-06|2024-01', 'cv')]);
    const issue = v.evidence.issues.find((i) => i.kind === 'conflict' && i.field === 'dates');
    expect(issue).toBeTruthy();
    expect(issue!.claimIds).toEqual([1, 2]);
    // The conflicting date is not presented as an established fact.
    expect(v.evidence.refs.some((r) => r.field === 'dates')).toBe(false);
  });
  it('unresolved title conflicts use the conservative public version (Boltcliq stays "Intern")', () => {
    const b = p.experiences.find((e: any) => e.company === 'The Boltcliq Company');
    expect(b.title).toMatch(/Intern/);
  });
});

describe('7–8. Human-written documents', () => {
  const analysis = () => ({ requirements: [matchRequirement({ skill: 'vue', label: 'Vue.js', importance: 'required', mentions: 2 }, p), matchRequirement({ skill: 'nodejs', label: 'Node.js', importance: 'required', mentions: 1 }, p)], experience: { responsibilities: ['Build and ship product features with Vue.js and Node.js'] } });
  it('the cover letter references a real project or employer from the evidence', () => {
    const cl = buildCoverLetter(p, job({ title: 'Vue.js Engineer' }), analysis(), null);
    const text = cl.paragraphs.join(' ');
    expect(p.projects.some((x: any) => text.includes(x.name)) && p.experiences.some((x: any) => text.includes(x.company))).toBe(true);
  });
  it('the generated cover letter contains no banned generic phrasing', () => {
    for (let id = 1; id <= 6; id++) {
      const text = buildCoverLetter(p, job({ id, title: 'Vue.js Engineer' }), analysis(), null).paragraphs.join(' ').toLowerCase();
      for (const b of BANNED_PHRASES) expect(text).not.toContain(b);
    }
  });
  it('QA rejects generic AI language and invented figures', () => {
    const bad = { paragraphs: ['I am thrilled to apply for the Full-Stack Engineer role at TestCo Acceptance. I am the perfect fit.', 'At Luvie LLC I increased conversion by 47% across 12 markets.'], signoff: '' };
    const r = qaDocument('cover_letter', bad, { p, job: job() });
    expect(r.passed).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Generic phrasing/);
    expect(r.errors.join(' ')).toMatch(/47/);
  });
});

describe('9–10. Missing information and QA', () => {
  it('a document with placeholders can pass QA but is never submittable', () => {
    const r = qaDocument('answers', { formQuestions: [{ question: 'Notice period', required: true, answer: '[ADD YOUR NOTICE PERIOD / START DATE]' }], common: [] }, { p, job: job() });
    expect(r.submittable).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/need your input/);
  });
  it('generated CV and cover letter pass QA (no errors)', () => {
    const reqs = analysisReqs();
    const cv = buildCv(p, job(), reqs);
    const cl = buildCoverLetter(p, job(), { requirements: reqs, experience: { responsibilities: [] } }, null);
    expect(qaDocument('cv', cv, { p, job: job() }).errors).toEqual([]);
    expect(qaDocument('cover_letter', { paragraphs: cl.paragraphs, signoff: cl.signoff }, { p, job: job() }).errors).toEqual([]);
  });
  function analysisReqs() { return ['react', 'nodejs', 'postgresql'].map((k) => matchRequirement({ skill: k, label: k, importance: 'required', mentions: 1 }, p)); }
});

describe('Automation tiers', () => {
  it('maps scores to the documented thresholds', () => {
    expect([95, 90, 89, 80, 79, 70, 69, 50, 49, 0].map(tierFor)).toEqual(['priority', 'priority', 'strong', 'strong', 'good', 'good', 'possible', 'possible', 'store', 'store']);
  });
});

describe('Sender identities (Resend)', () => {
  it('reports "not configured" honestly and sends nothing when the API key is missing', async () => {
    const saved = config.resend.apiKey; config.resend.apiKey = '';
    try {
      const st = await identityStatus('job_application', true);
      expect(st.configured).toBe(false);
      expect(st.missing).toContain('RESEND_API_KEY');
      const r = await sendEmail({ identity: 'job_application', to: 'jobs@example.com', subject: 'ACCEPTANCE TEST application', text: 'x', userId });
      expect(r.ok).toBe(false); expect(r.status).toBe('not_configured'); expect(r.id).toBeNull();
      const log = await one(`SELECT * FROM email_log WHERE id=$1`, [r.logId]);
      expect(log.status).toBe('not_configured'); expect(log.identity).toBe('job_application');
    } finally { config.resend.apiKey = saved; }
  });
  it('the notifications identity can never email anyone except your own inbox', async () => {
    const r = await sendEmail({ identity: 'notifications', to: 'recruiter@example.com', subject: 'ACCEPTANCE TEST notification', text: 'x', userId });
    expect(r.ok).toBe(false); expect(r.status).toBe('rejected');
  });
  it('job applications are never sent under the "CareerPilot AI" name and never fall back to the notifications sender', async () => {
    const saved = { ...config.jobApplication };
    try {
      config.jobApplication.fromName = 'CareerPilot AI';
      expect((await identityStatus('job_application', true)).configured).toBe(false);
      config.jobApplication.fromName = saved.fromName; config.jobApplication.fromEmail = '';
      const st = await identityStatus('job_application', true);
      expect(st.configured).toBe(false);
      expect(st.missing).toContain('JOB_APPLICATION_FROM_EMAIL');
    } finally { Object.assign(config.jobApplication, saved); }
  });
  it('the application identity is your own name and address', () => {
    expect(config.jobApplication.fromName).toBe('Alawiye Muritala Adeshina');
    expect(config.jobApplication.fromEmail).toBe('me@alawiyemuritala.xyz');
    expect(config.resend.fromEmail).toBe('notifications@alawiyemuritala.xyz');
  });
  it('WhatsApp being disconnected is reported without throwing (email path is independent)', async () => {
    const r = await sendWhatsApp('', 'x', 90, 'http://localhost');
    expect(r.ok).toBe(false); expect(r.status).toBe('not_configured');
  });
});
