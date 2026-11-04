import { computeFreshness } from './freshness.js';
import { json, one, q } from '../db.js';
import { fingerprint, normKey } from '../lib/text.js';
import type { RawJob } from '../sources/types.js';
import { loadProfile, type FullProfile } from './profile.js';
import { scoreJob, type Analysis, type ScoringInputs } from './scoring.js';
import { getSettings } from './settings.js';
import { parseSalaryText, findSalaryInDescription } from './salary.js';
import { extractEmails } from '../lib/text.js';
import { isSoftwareRole } from './extract.js';

const ATS_PATTERNS: [RegExp, string][] = [
  [/greenhouse\.io/i, 'greenhouse'], [/lever\.co/i, 'lever'], [/ashbyhq\.com/i, 'ashby'], [/workable\.com/i, 'workable'],
  [/smartrecruiters\.com/i, 'smartrecruiters'], [/bamboohr\.com/i, 'bamboohr'], [/recruitee\.com/i, 'recruitee'], [/teamtailor\.com/i, 'teamtailor'],
  [/myworkdayjobs\.com|workday/i, 'workday'], [/breezy\.hr/i, 'breezy'], [/jobvite\.com/i, 'jobvite'], [/personio\./i, 'personio'], [/icims\.com/i, 'icims'], [/rippling\.com/i, 'rippling'],
];
export const detectAts = (url?: string | null) => (url ? ATS_PATTERNS.find(([re]) => re.test(url))?.[1] ?? null : null);

export async function upsertCompany(name: string, website?: string | null) {
  const key = normKey(name) || name.toLowerCase();
  const row = await one<{ id: number }>(
    `INSERT INTO companies (name, name_key, website) VALUES ($1,$2,$3)
     ON CONFLICT (name_key) DO UPDATE SET website = COALESCE(companies.website, EXCLUDED.website) RETURNING id`,
    [name, key, website ?? null],
  );
  return row!.id;
}

export interface UpsertResult { id: number; inserted: boolean; duplicateOf: number | null; repost: boolean }

/** Insert or update a job; link cross-source duplicates by company+title fingerprint; detect reposts. */
export async function upsertJob(userId: number, r: RawJob): Promise<UpsertResult> {
  const fp = fingerprint(r.company, r.title);
  const companyId = await upsertCompany(r.company, r.companyWebsite);
  const sal = r.salaryMin ? null : parseSalaryText(r.salaryRaw) ?? null;
  const emails = extractEmails(r.descriptionText ?? '').filter((e) => !/noreply|no-reply|privacy|gdpr|security|abuse/.test(e));
  const existing = await one<{ id: number; posted_at: string | null; status: string }>('SELECT id, posted_at, status FROM jobs WHERE user_id=$1 AND source=$2 AND source_job_id=$3', [userId, r.source, r.sourceJobId]);

  const vals = [
    userId, r.source, r.sourceJobId, r.sourceUrl, r.title.trim(), r.company.trim(), companyId, fp, r.postedAt ?? null, r.deadline ?? null,
    r.descriptionHtml ?? null, r.descriptionText ?? null, r.locationRaw ?? null, json(r.locationRestrictions ?? []), r.employmentType ?? null, r.seniority ?? null,
    r.salaryRaw ?? sal?.raw ?? null, r.salaryMin ?? sal?.min ?? null, r.salaryMax ?? sal?.max ?? null, r.salaryCurrency ?? sal?.currency ?? null, r.salaryPeriod ?? sal?.period ?? null,
    r.salaryMin ? 'listing' : sal ? 'listing' : null, json(r.tags ?? []), r.applyUrl ?? r.sourceUrl, emails[0] ?? null, r.ats ?? detectAts(r.applyUrl) ?? detectAts(r.sourceUrl), json({ ...(r.raw as any ?? {}), timezoneRestrictions: r.timezoneRestrictions ?? [] }),
  ];

  if (existing) {
    await q(
      `UPDATE jobs SET source_url=$4, title=$5, company_name=$6, company_id=$7, fingerprint=$8, posted_at=COALESCE($9, posted_at), deadline=$10,
        description_html=$11, description_text=$12, location_raw=$13, location_restrictions=$14, employment_type=$15, seniority=$16,
        salary_raw=$17, salary_min=$18, salary_max=$19, salary_currency=$20, salary_period=$21, salary_source=$22, tags=$23, apply_url=$24, apply_email=$25, ats=$26, raw=$27,
        status = CASE WHEN status='expired' THEN 'active' ELSE status END,
        repost_count = CASE WHEN status='expired' THEN repost_count+1 ELSE repost_count END,
        last_checked_at=now(), last_check_result='Seen in source feed'
       WHERE user_id=$1 AND source=$2 AND source_job_id=$3`, vals);
    // Being listed on the employer's own ATS board is a conclusive "still open" signal.
    if (['greenhouse', 'lever', 'ashby', 'workable'].includes(r.source)) await q(`UPDATE jobs SET last_verified_open_at=now() WHERE id=$1`, [existing.id]);
    await computeFreshness(existing.id);
    return { id: existing.id, inserted: false, duplicateOf: null, repost: existing.status === 'expired' };
  }

  // Duplicate across sources (or a repost with a new id on the same source).
  const dup = await one<{ id: number; source: string; status: string }>(
    `SELECT id, source, status FROM jobs WHERE user_id=$1 AND fingerprint=$2 AND duplicate_of IS NULL ORDER BY (source IN ('greenhouse','lever','ashby','workable')) DESC, id LIMIT 1`, [userId, fp]);
  const ins = await one<{ id: number }>(
    `INSERT INTO jobs (user_id, source, source_job_id, source_url, title, company_name, company_id, fingerprint, posted_at, deadline,
      description_html, description_text, location_raw, location_restrictions, employment_type, seniority,
      salary_raw, salary_min, salary_max, salary_currency, salary_period, salary_source, tags, apply_url, apply_email, ats, raw, duplicate_of, repost_count, last_checked_at, last_check_result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, now(), 'Seen in source feed') RETURNING id`,
    [...vals, dup?.id ?? null, dup && dup.source === r.source && dup.status === 'expired' ? 1 : 0],
  );
  if (dup) {
    await q(`UPDATE jobs SET also_seen_on = also_seen_on || $2::jsonb WHERE id=$1 AND NOT (also_seen_on @> $2::jsonb)`, [dup.id, json([{ source: r.source, url: r.sourceUrl, job_id: ins!.id }])]);
    // An expired canonical job reappearing under a new id is a repost.
    if (dup.source === r.source && dup.status === 'expired') await q(`UPDATE jobs SET repost_count=repost_count+1 WHERE id=$1`, [dup.id]);
  }
  if (['greenhouse', 'lever', 'ashby', 'workable'].includes(r.source)) await q(`UPDATE jobs SET last_verified_open_at=now() WHERE id=$1`, [ins!.id]);
  await computeFreshness(ins!.id);
  if (dup) await computeFreshness(dup.id);
  return { id: ins!.id, inserted: true, duplicateOf: dup?.id ?? null, repost: !!dup && dup.source === r.source && dup.status === 'expired' };
}

export async function analyseJob(userId: number, jobId: number, profile?: FullProfile, pre?: ScoringInputs): Promise<Analysis> {
  if (!pre) {
    const ext = await one('SELECT data FROM job_extractions WHERE job_id=$1', [jobId]);
    if (ext) pre = { extracted: ext.data };
  }
  const job = await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [jobId, userId]);
  if (!job) throw new Error('Job not found');
  const p = profile ?? (await loadProfile(userId));
  const s = await getSettings(userId);
  if (!job.salary_min && !job.salary_raw) {
    const d = findSalaryInDescription(job.description_text ?? '');
    if (d) Object.assign(job, { salary_min: d.min, salary_max: d.max, salary_currency: d.currency, salary_period: d.period, salary_raw: d.raw });
  } else if (job.salary_raw) {
    // Re-parse stored salary text so parser fixes apply to existing rows.
    const r = parseSalaryText(job.salary_raw);
    if (r) Object.assign(job, { salary_min: r.min, salary_max: r.max, salary_currency: r.currency ?? job.salary_currency, salary_period: r.period });
  }
  const a = scoreJob(job, p, { weights: s.scoring_weights, fx: s.fx_rates, minNgn: Number(s.min_salary_ngn_monthly), targetNgn: Number(s.target_salary_ngn_monthly), pre });
  await q(
    `INSERT INTO job_analyses (job_id,total_score,classification,actionable,breakdown,requirements,matched,partial,missing,eligibility,salary,experience,concerns,recommendation,rationale,weights,analysed_at,engine)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),'rules-v1')
     ON CONFLICT (job_id) DO UPDATE SET total_score=$2,classification=$3,actionable=$4,breakdown=$5,requirements=$6,matched=$7,partial=$8,missing=$9,eligibility=$10,salary=$11,experience=$12,concerns=$13,recommendation=$14,rationale=$15,weights=$16,analysed_at=now()`,
    [jobId, a.total, a.classification, a.actionable, json(a.breakdown), json(a.requirements), json(a.matched), json(a.partial), json(a.missing), json(a.eligibility), json(a.salary),
      json({ ...a.experience, responsibilities: a.extracted.responsibilities, requirementLines: a.extracted.requirementLines, screeningHints: a.extracted.screeningHints }), json(a.concerns), a.recommendation, a.rationale, json(a.weights)],
  );
  // Ensure a tracking row exists; promote status automatically only in the early pipeline stages.
  const status = !a.actionable ? 'discovered' : a.total >= 70 ? 'recommended' : 'discovered';
  await q(
    `INSERT INTO applications (user_id, job_id, status, history) VALUES ($1,$2,$3,$4)
     ON CONFLICT (job_id) DO UPDATE SET status = CASE WHEN applications.status IN ('discovered','analysing','recommended') THEN EXCLUDED.status ELSE applications.status END`,
    [userId, jobId, status, json([{ status, at: new Date().toISOString(), note: 'Auto-analysed' }])],
  );
  return a;
}

/** Remove stored jobs that no longer pass the relevance filter, unless the user has already acted on them. */
export async function pruneIrrelevant(userId: number) {
  const rows = await q<{ id: number; title: string; description_text: string | null }>(
    `SELECT j.id, j.title, j.description_text FROM jobs j LEFT JOIN applications ap ON ap.job_id=j.id
     WHERE j.user_id=$1 AND COALESCE(ap.status,'discovered') IN ('discovered','recommended','analysing','expired')`, [userId]);
  const bad = rows.filter((r) => !isSoftwareRole(r.title, r.description_text ?? '')).map((r) => r.id);
  if (bad.length) await q('DELETE FROM jobs WHERE id = ANY($1)', [bad]);
  return bad.length;
}

export async function reanalyseAll(userId: number) {
  await pruneIrrelevant(userId);
  const p = await loadProfile(userId);
  const ids = await q<{ id: number }>('SELECT id FROM jobs WHERE user_id=$1 AND duplicate_of IS NULL', [userId]);
  for (const { id } of ids) await analyseJob(userId, id, p);
  return ids.length;
}
