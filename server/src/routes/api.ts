import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { aiStatus, monthSpend } from '../ai/provider.js';
import { clearSessionCookie, hashPassword, login, requireAuth, setSessionCookie, type AuthedRequest } from '../auth.js';
import { json, one, q } from '../db.js';
import { generateAll, generateMasterCv, period } from '../docs/generate.js';
import { cvDocx, cvPdf, letterDocx, letterPdf } from '../docs/render.js';
import { isDiscoveryRunning } from '../engine/discovery.js';
import { importFromUrl } from '../engine/importer.js';
import { loadProfile } from '../engine/profile.js';
import { recheckJob, recheckStale } from '../engine/recheck.js';
import { researchJob } from '../engine/research.js';
import { fetchFxRates } from '../engine/salary.js';
import { getSettings } from '../engine/settings.js';
import { skillGap } from '../engine/skillgap.js';
import { analyseJob, reanalyseAll, upsertJob } from '../engine/store.js';
import { SOURCES } from '../sources/index.js';
import { backupDatabase, enqueueDiscovery, scheduleDiscovery } from '../scheduler.js';
import { SKILLS } from '../lib/taxonomy.js';
import bcrypt from 'bcryptjs';
import { automation } from './automation.js';
import { compose } from './compose.js';
import { startWorkflow } from '../agents/core/orchestrator.js';

export const api = Router();
type R = AuthedRequest;
const wrap = (fn: (req: R, res: Response) => Promise<unknown>) => (req: R, res: Response) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e instanceof z.ZodError ? 400 : e.status ?? 500).json({ error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.message });
});

export const STATUSES = ['discovered', 'analysing', 'recommended', 'ready_to_apply', 'applied', 'assessment', 'interview', 'technical_interview', 'final_interview', 'offer', 'rejected', 'withdrawn', 'expired'] as const;

// ---------- Auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
api.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const t = await login(email, password);
  if (!t) return res.status(401).json({ error: 'Invalid email or password' });
  setSessionCookie(res, t); res.json({ ok: true });
}));
api.post('/auth/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

api.use(requireAuth);
api.use(automation);
api.use(compose);
api.get('/auth/me', wrap(async (req, res) => res.json(await one('SELECT id, email FROM users WHERE id=$1', [req.userId]))));
api.post('/auth/password', wrap(async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(10) }).parse(req.body);
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.userId]);
  if (!(await bcrypt.compare(current, u.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.userId, await hashPassword(next)]); res.json({ ok: true });
}));

// ---------- Profile ----------
api.get('/profile', wrap(async (req, res) => {
  const p = await loadProfile(req.userId!);
  res.json({ profile: p.profile, skills: await q('SELECT * FROM skills WHERE user_id=$1 ORDER BY category, id', [req.userId]), experiences: p.experiences, projects: p.projects, education: p.education, professionalYears: p.professionalYears, taxonomy: SKILLS.map(({ key, label, category }) => ({ key, label, category })) });
}));
api.put('/profile', wrap(async (req, res) => {
  const b = z.object({ full_name: z.string().min(1), headline: z.string().nullable(), location: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), links: z.record(z.string(), z.string()), summary: z.string().nullable(), target_roles: z.array(z.string()), target_level: z.string(), availability: z.string().nullable(), verification_flags: z.array(z.any()).optional() }).parse(req.body);
  await q(`UPDATE profiles SET full_name=$2, headline=$3, location=$4, email=$5, phone=$6, links=$7, summary=$8, target_roles=$9, target_level=$10, availability=$11, verification_flags=COALESCE($12, verification_flags), updated_at=now() WHERE user_id=$1`,
    [req.userId, b.full_name, b.headline, b.location, b.email, b.phone, json(b.links), b.summary, json(b.target_roles), b.target_level, b.availability, b.verification_flags ? json(b.verification_flags) : null]);
  res.json({ ok: true });
}));
const skillSchema = z.object({ name: z.string(), label: z.string(), category: z.string(), proficiency: z.enum(['expert', 'advanced', 'intermediate', 'basic', 'learning']), professional: z.boolean(), years: z.number().nullable().optional(), evidence: z.string().nullable().optional() });
api.post('/profile/skills', wrap(async (req, res) => {
  const s = skillSchema.parse(req.body);
  res.json(await one(`INSERT INTO skills (user_id,name,label,category,proficiency,professional,years,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (user_id,name) DO UPDATE SET label=$3, category=$4, proficiency=$5, professional=$6, years=$7, evidence=$8 RETURNING *`, [req.userId, s.name, s.label, s.category, s.proficiency, s.professional, s.years ?? null, s.evidence ?? null]));
}));
api.delete('/profile/skills/:id', wrap(async (req, res) => { await q('DELETE FROM skills WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]); res.json({ ok: true }); }));

const expSchema = z.object({ company: z.string().min(1), company_url: z.string().nullable().optional(), title: z.string().min(1), start_date: z.string().nullable(), end_date: z.string().nullable(), is_current: z.boolean(), employment_type: z.string().nullable().optional(), description: z.string().nullable().optional(), bullets: z.array(z.string()), technologies: z.array(z.string()), needs_verification: z.boolean(), verification_note: z.string().nullable().optional(), sort_order: z.number().optional() });
api.post('/profile/experiences', wrap(async (req, res) => {
  const e = expSchema.parse(req.body);
  res.json(await one(`INSERT INTO experiences (user_id,company,company_url,title,start_date,end_date,is_current,employment_type,description,bullets,technologies,needs_verification,verification_note,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.userId, e.company, e.company_url ?? null, e.title, e.start_date, e.end_date, e.is_current, e.employment_type ?? null, e.description ?? null, json(e.bullets), json(e.technologies), e.needs_verification, e.verification_note ?? null, e.sort_order ?? 99]));
}));
api.put('/profile/experiences/:id', wrap(async (req, res) => {
  const e = expSchema.parse(req.body);
  await q(`UPDATE experiences SET company=$3,company_url=$4,title=$5,start_date=$6,end_date=$7,is_current=$8,employment_type=$9,description=$10,bullets=$11,technologies=$12,needs_verification=$13,verification_note=$14,sort_order=COALESCE($15,sort_order) WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.userId, e.company, e.company_url ?? null, e.title, e.start_date, e.end_date, e.is_current, e.employment_type ?? null, e.description ?? null, json(e.bullets), json(e.technologies), e.needs_verification, e.verification_note ?? null, e.sort_order ?? null]);
  res.json({ ok: true });
}));
api.delete('/profile/experiences/:id', wrap(async (req, res) => { await q('DELETE FROM experiences WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]); res.json({ ok: true }); }));

const projSchema = z.object({ name: z.string().min(1), url: z.string().nullable().optional(), repo_url: z.string().nullable().optional(), problem: z.string().nullable().optional(), contribution: z.string().nullable().optional(), team_context: z.string().nullable().optional(), technologies: z.array(z.string()), features: z.array(z.string()), architecture: z.string().nullable().optional(), challenges: z.string().nullable().optional(), evidence: z.string().nullable().optional(), needs_verification: z.boolean() });
api.post('/profile/projects', wrap(async (req, res) => {
  const p = projSchema.parse(req.body);
  res.json(await one(`INSERT INTO projects (user_id,name,url,repo_url,problem,contribution,team_context,technologies,features,architecture,challenges,evidence,needs_verification) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.userId, p.name, p.url ?? null, p.repo_url ?? null, p.problem ?? null, p.contribution ?? null, p.team_context ?? null, json(p.technologies), json(p.features), p.architecture ?? null, p.challenges ?? null, p.evidence ?? null, p.needs_verification]));
}));
api.put('/profile/projects/:id', wrap(async (req, res) => {
  const p = projSchema.parse(req.body);
  await q(`UPDATE projects SET name=$3,url=$4,repo_url=$5,problem=$6,contribution=$7,team_context=$8,technologies=$9,features=$10,architecture=$11,challenges=$12,evidence=$13,needs_verification=$14 WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.userId, p.name, p.url ?? null, p.repo_url ?? null, p.problem ?? null, p.contribution ?? null, p.team_context ?? null, json(p.technologies), json(p.features), p.architecture ?? null, p.challenges ?? null, p.evidence ?? null, p.needs_verification]);
  res.json({ ok: true });
}));
api.delete('/profile/projects/:id', wrap(async (req, res) => { await q('DELETE FROM projects WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]); res.json({ ok: true }); }));
api.post('/profile/education', wrap(async (req, res) => {
  const e = z.object({ institution: z.string().min(1), credential: z.string().nullable().optional(), period: z.string().nullable().optional() }).parse(req.body);
  res.json(await one('INSERT INTO education (user_id,institution,credential,period) VALUES ($1,$2,$3,$4) RETURNING *', [req.userId, e.institution, e.credential ?? null, e.period ?? null]));
}));
api.delete('/profile/education/:id', wrap(async (req, res) => { await q('DELETE FROM education WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]); res.json({ ok: true }); }));
api.post('/profile/reanalyse', wrap(async (req, res) => res.json({ reanalysed: await reanalyseAll(req.userId!) })));

// ---------- Jobs ----------
// Repost-resistant publication date (see engine/freshness.ts).
const PUB = 'COALESCE(j.effective_published_at, j.posted_at, j.discovered_at)';
const AGE = `EXTRACT(EPOCH FROM (now() - ${PUB})) / 86400`;
const SORTS: Record<string, string> = {
  // Default: newest eligible roles first, with the match score as the main factor inside that.
  smart: `(a.eligibility->>'status' IN ('eligible','likely')) DESC NULLS LAST, (COALESCE(a.total_score,0) + CASE WHEN ${AGE} <= 1 THEN 12 WHEN ${AGE} <= 3 THEN 9 WHEN ${AGE} <= 7 THEN 6 WHEN ${AGE} <= 14 THEN 3 WHEN ${AGE} <= 30 THEN 0 ELSE -15 END) DESC, ${PUB} DESC`,
  match: `a.total_score DESC NULLS LAST, ${PUB} DESC NULLS LAST`, newest: `${PUB} DESC NULLS LAST`,
  salary: `COALESCE((a.salary->>'ngnMonthlyMax')::numeric, -1) DESC`, deadline: 'j.deadline ASC NULLS LAST',
  technical: `(SELECT (c->>'score')::numeric FROM jsonb_array_elements(a.breakdown) c WHERE c->>'key'='technical') DESC NULLS LAST`,
};
api.get('/jobs', wrap(async (req, res) => {
  const f = z.object({
    sort: z.string().optional(), minScore: z.coerce.number().optional(), eligibility: z.string().optional(), status: z.string().optional(), q: z.string().optional(),
    tech: z.string().optional(), level: z.string().optional(), type: z.string().optional(), minSalaryNgn: z.coerce.number().optional(), source: z.string().optional(),
    recommended: z.string().optional(), postedWithin: z.coerce.number().int().min(1).max(365).optional(), includeOld: z.string().optional(), limit: z.coerce.number().max(500).optional(), offset: z.coerce.number().optional(), includeDuplicates: z.string().optional(),
  }).parse(req.query);
  const where = ['j.user_id=$1']; const p: unknown[] = [req.userId];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (!f.includeDuplicates) where.push('j.duplicate_of IS NULL');
  if (f.minScore !== undefined) add('a.total_score >= ?', f.minScore);
  if (f.eligibility) add(`a.eligibility->>'status' = ANY(?)`, f.eligibility.split(','));
  if (f.status) add('j.status = ANY(?)', f.status.split(','));
  else where.push(`j.status <> 'expired'`);
  if (f.q) add(`(j.title ILIKE ? OR j.company_name ILIKE $${p.length + 1})`, `%${f.q}%`);
  if (f.tech) add(`EXISTS (SELECT 1 FROM jsonb_array_elements(a.requirements) r WHERE r->>'skill' = ANY(?))`, f.tech.split(','));
  if (f.level) add(`a.experience->>'seniority' = ANY(?)`, f.level.split(','));
  if (f.type) add(`j.employment_type ILIKE ?`, `%${f.type}%`);
  if (f.minSalaryNgn) add(`(a.salary->>'ngnMonthlyMax')::numeric >= ?`, f.minSalaryNgn);
  if (f.source) add('j.source = ANY(?)', f.source.split(','));
  if (f.postedWithin) add(`${PUB} >= now() - (? || ' days')::interval`, String(f.postedWithin));
  // Older than 30 days is hidden unless it was verified open in the last 48h (or the user asks to include old jobs).
  if (!f.includeOld && !f.postedWithin) where.push(`(${PUB} >= now() - interval '30 days' OR j.last_verified_open_at >= now() - interval '48 hours')`);
  if (f.recommended) where.push(`a.actionable AND a.total_score >= 70`);
  p.push(f.limit ?? 100, f.offset ?? 0);
  const rows = await q(`
    SELECT j.id, j.title, j.company_name, j.source, j.source_url, j.posted_at, j.discovered_at, j.deadline, j.effective_published_at, j.original_published_at, j.publication_verified, j.publication_note, j.posted_at_source, j.last_verified_open_at, j.is_repost, j.source_updated_at, ap.tier, ap.automation_status, ap.approval_status, j.location_raw, j.employment_type, j.status, j.last_checked_at, j.also_seen_on, j.repost_count,
      a.total_score, a.classification, a.actionable, a.recommendation, a.eligibility->>'status' AS eligibility, a.eligibility->>'summary' AS eligibility_summary,
      a.salary, a.experience->>'seniority' AS seniority, a.matched, a.missing, a.breakdown, ap.status AS app_status, r.official_url_verified
    FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id LEFT JOIN applications ap ON ap.job_id=j.id LEFT JOIN job_research r ON r.job_id=j.id
    WHERE ${where.join(' AND ')} ORDER BY ${SORTS[f.sort ?? 'smart'] ?? SORTS.smart} LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  const total = await one(`SELECT count(*)::int n FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id WHERE ${where.join(' AND ')}`, p.slice(0, -2));
  res.json({ total: total?.n ?? 0, jobs: rows });
}));
api.get('/jobs/:id', wrap(async (req, res) => {
  const job = await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const [analysis, research, application, company, docs, dups] = await Promise.all([
    one('SELECT * FROM job_analyses WHERE job_id=$1', [job.id]), one('SELECT * FROM job_research WHERE job_id=$1', [job.id]),
    one('SELECT * FROM applications WHERE job_id=$1', [job.id]), job.company_id ? one('SELECT * FROM companies WHERE id=$1', [job.company_id]) : null,
    q(`SELECT DISTINCT ON (kind) * FROM documents WHERE job_id=$1 ORDER BY kind, version DESC`, [job.id]),
    q('SELECT id, source, source_url FROM jobs WHERE duplicate_of=$1', [job.id]),
  ]);
  delete job.raw;
  res.json({ job, analysis, research, application, company, documents: docs, duplicates: dups, source: SOURCES.find((s) => s.id === job.source) ?? { name: job.source } });
}));
api.post('/jobs/:id/analyse', wrap(async (req, res) => res.json(await analyseJob(req.userId!, Number(req.params.id)))));
api.post('/jobs/:id/research', wrap(async (req, res) => res.json(await researchJob(req.userId!, Number(req.params.id)))));
api.post('/jobs/:id/recheck', wrap(async (req, res) => res.json(await recheckJob(req.userId!, Number(req.params.id)))));
/**
 * One-click "prepare application". Default: runs the agent pipeline in the background (returns runId).
 * ?sync=1 keeps the original synchronous path: recheck → research → (re)analyse → generate all documents.
 */
api.post('/jobs/:id/prepare', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (req.query.sync !== '1') {
    if (!(await one('SELECT 1 FROM jobs WHERE id=$1 AND user_id=$2', [id, req.userId]))) return res.status(404).json({ error: 'Not found' });
    return res.json({ runId: await startWorkflow(req.userId!, 'opportunity', { jobId: id, manual: true, forceDocs: true }, 'manual') });
  }
  const check = await recheckJob(req.userId!, id);
  const research = await researchJob(req.userId!, id);
  const analysis = await analyseJob(req.userId!, id);
  const docs = await generateAll(req.userId!, id);
  res.json({ check, research, analysis: { total: analysis.total, classification: analysis.classification }, documents: Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.id])) });
}));
api.post('/jobs/:id/documents', wrap(async (req, res) => res.json(await generateAll(req.userId!, Number(req.params.id)))));
api.post('/jobs/import', wrap(async (req, res) => {
  const b = z.object({ url: z.string().url(), title: z.string().optional(), company: z.string().optional(), description: z.string().optional(), location: z.string().optional() }).parse(req.body);
  const raw = await importFromUrl(b);
  const r = await upsertJob(req.userId!, raw);
  await analyseJob(req.userId!, r.id);
  res.json({ id: r.id, duplicateOf: r.duplicateOf });
}));

// ---------- Documents ----------
api.get('/documents', wrap(async (req, res) => res.json(await q(`SELECT d.id, d.job_id, d.kind, d.version, d.title, d.engine, d.warnings, d.created_at, d.updated_at, j.company_name, j.title AS job_title
  FROM documents d LEFT JOIN jobs j ON j.id=d.job_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 300`, [req.userId]))));
api.get('/documents/:id', wrap(async (req, res) => res.json(await one('SELECT * FROM documents WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]))));
api.put('/documents/:id', wrap(async (req, res) => {
  const { content } = z.object({ content: z.any() }).parse(req.body);
  await q('UPDATE documents SET content=$3, updated_at=now() WHERE id=$1 AND user_id=$2', [req.params.id, req.userId, json(content)]); res.json({ ok: true });
}));
api.post('/documents/master-cv', wrap(async (req, res) => res.json(await generateMasterCv(req.userId!))));
api.get('/documents/:id/download', wrap(async (req, res) => {
  const fmt = z.enum(['pdf', 'docx', 'txt']).parse(req.query.format ?? 'pdf');
  const d = await one('SELECT * FROM documents WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const p = await one('SELECT full_name, email, phone, links FROM profiles WHERE user_id=$1', [req.userId]);
  const base = `${p.full_name.replace(/\s+/g, '_')}_${d.kind === 'cv' ? 'CV' : 'Cover_Letter'}_${(d.content?.meta?.company || d.title.split('@')[1] || 'master').trim().replace(/[^\w]+/g, '_')}`;
  let buf: Buffer; let type: string;
  if (d.kind === 'cv') { buf = fmt === 'docx' ? await cvDocx(d.content) : await cvPdf(d.content); }
  else if (d.kind === 'cover_letter') {
    const contact = [p.email, p.phone, p.links?.portfolio].filter(Boolean).join(' · ');
    buf = fmt === 'docx' ? await letterDocx(p.full_name, contact, d.content) : await letterPdf(p.full_name, contact, d.content);
  } else { buf = Buffer.from(JSON.stringify(d.content, null, 2)); type = 'application/json'; res.setHeader('Content-Type', type); return res.send(buf); }
  type = fmt === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${base}.${fmt}"`);
  res.send(buf);
}));

// ---------- Applications ----------
api.get('/applications', wrap(async (req, res) => res.json(await q(`
  SELECT ap.*, j.title, j.company_name, j.source, j.source_url, j.deadline, j.status AS job_status, a.total_score, a.classification, r.official_url, r.official_url_verified,
    cv.version AS cv_version, cl.version AS cover_version
  FROM applications ap JOIN jobs j ON j.id=ap.job_id LEFT JOIN job_analyses a ON a.job_id=j.id LEFT JOIN job_research r ON r.job_id=j.id
  LEFT JOIN documents cv ON cv.id=ap.cv_document_id LEFT JOIN documents cl ON cl.id=ap.cover_document_id
  WHERE ap.user_id=$1 AND (ap.status NOT IN ('discovered') OR $2::boolean) ORDER BY ap.updated_at DESC`, [req.userId, req.query.all === '1']))));
api.put('/applications/:jobId', wrap(async (req, res) => {
  const b = z.object({ status: z.enum(STATUSES).optional(), applied_at: z.string().nullable().optional(), follow_up_at: z.string().nullable().optional(), recruiter: z.record(z.string(), z.any()).optional(), interviews: z.array(z.any()).optional(), notes: z.string().nullable().optional(), outcome: z.string().nullable().optional(), destination: z.string().nullable().optional() }).parse(req.body);
  const cur = await one('SELECT * FROM applications WHERE job_id=$1 AND user_id=$2', [req.params.jobId, req.userId]);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const appliedAt = b.status === 'applied' && !cur.applied_at ? new Date().toISOString() : b.applied_at !== undefined ? b.applied_at : cur.applied_at;
  const followUp = b.status === 'applied' && !cur.follow_up_at && b.follow_up_at === undefined ? new Date(Date.now() + 7 * 864e5).toISOString() : b.follow_up_at !== undefined ? b.follow_up_at : cur.follow_up_at;
  await q(`UPDATE applications SET status=$3, applied_at=$4, follow_up_at=$5, recruiter=$6, interviews=$7, notes=$8, outcome=$9, destination=$10, updated_at=now(),
    history = CASE WHEN $3 <> status THEN history || $11::jsonb ELSE history END WHERE job_id=$1 AND user_id=$2`,
    [req.params.jobId, req.userId, b.status ?? cur.status, appliedAt, followUp, json(b.recruiter ?? cur.recruiter), json(b.interviews ?? cur.interviews), b.notes !== undefined ? b.notes : cur.notes, b.outcome !== undefined ? b.outcome : cur.outcome, b.destination !== undefined ? b.destination : cur.destination,
      json([{ status: b.status ?? cur.status, at: new Date().toISOString() }])]);
  res.json(await one('SELECT * FROM applications WHERE job_id=$1', [req.params.jobId]));
}));

// ---------- Dashboard & analytics ----------
api.get('/dashboard', wrap(async (req, res) => {
  const u = req.userId;
  const [counts, top, deadlines, research, runs, pipeline, gap, followups] = await Promise.all([
    one(`SELECT
      count(*) FILTER (WHERE j.discovered_at >= date_trunc('day', now()))::int AS new_today,
      count(*)::int AS total,
      count(*) FILTER (WHERE a.total_score >= 90 AND a.actionable)::int AS excellent,
      count(*) FILTER (WHERE a.total_score >= 80 AND a.actionable)::int AS above80,
      count(*) FILTER (WHERE a.total_score >= 70 AND a.actionable)::int AS matching,
      count(*) FILTER (WHERE a.eligibility->>'status' IN ('eligible','likely'))::int AS nigeria_ok,
      count(*) FILTER (WHERE j.status='expired')::int AS expired
      FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id WHERE j.user_id=$1 AND j.duplicate_of IS NULL`, [u]),
    q(`SELECT j.id, j.title, j.company_name, j.posted_at, j.source, a.total_score, a.classification, a.eligibility->>'status' eligibility, a.salary->>'original' salary, ap.status app_status
       FROM jobs j JOIN job_analyses a ON a.job_id=j.id LEFT JOIN applications ap ON ap.job_id=j.id
       WHERE j.user_id=$1 AND j.duplicate_of IS NULL AND j.status<>'expired' AND a.actionable ORDER BY a.total_score DESC, j.posted_at DESC NULLS LAST LIMIT 8`, [u]),
    q(`SELECT j.id, j.title, j.company_name, j.deadline, a.total_score FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id
       WHERE j.user_id=$1 AND j.deadline >= now() AND j.status<>'expired' ORDER BY j.deadline LIMIT 6`, [u]),
    q(`SELECT r.job_id, r.employer, r.official_url_verified, r.apply_method, r.researched_at, j.title FROM job_research r JOIN jobs j ON j.id=r.job_id WHERE j.user_id=$1 ORDER BY r.researched_at DESC LIMIT 5`, [u]),
    q(`SELECT r.*, (SELECT json_agg(s ORDER BY s.id) FROM source_logs s WHERE s.run_id=r.id) AS sources FROM search_runs r WHERE r.user_id=$1 ORDER BY r.id DESC LIMIT 5`, [u]),
    q(`SELECT status, count(*)::int n FROM applications WHERE user_id=$1 GROUP BY status`, [u]),
    skillGap(u!).then((g) => g.recommendations.slice(0, 5).map(({ jobs: _j, ...r }) => r)),
    q(`SELECT ap.job_id, ap.follow_up_at, j.title, j.company_name FROM applications ap JOIN jobs j ON j.id=ap.job_id WHERE ap.user_id=$1 AND ap.follow_up_at IS NOT NULL AND ap.status IN ('applied','assessment','interview','technical_interview','final_interview') ORDER BY ap.follow_up_at LIMIT 5`, [u]),
  ]);
  res.json({ counts, top, deadlines, research, runs, pipeline, gap, followups, running: isDiscoveryRunning() });
}));
api.get('/analytics', wrap(async (req, res) => {
  const u = req.userId;
  const funnel = await one(`SELECT
      (SELECT count(*) FROM jobs WHERE user_id=$1 AND duplicate_of IS NULL)::int AS discovered,
      count(*) FILTER (WHERE a.total_score >= 70 AND a.actionable)::int AS matching,
      count(*) FILTER (WHERE a.total_score >= 80 AND a.actionable)::int AS above80,
      count(*) FILTER (WHERE ap.status NOT IN ('discovered','recommended','analysing','expired'))::int AS prepared,
      count(*) FILTER (WHERE ap.applied_at IS NOT NULL)::int AS applied,
      count(*) FILTER (WHERE ap.status IN ('interview','technical_interview','final_interview','offer') OR jsonb_array_length(ap.interviews) > 0)::int AS interviews,
      count(*) FILTER (WHERE ap.status='rejected')::int AS rejected,
      count(*) FILTER (WHERE ap.status='offer')::int AS offers
    FROM applications ap JOIN job_analyses a ON a.job_id=ap.job_id WHERE ap.user_id=$1`, [u]);
  const bySource = await q(`SELECT j.source, count(*)::int discovered, count(*) FILTER (WHERE a.total_score>=70 AND a.actionable)::int matching,
      count(*) FILTER (WHERE ap.applied_at IS NOT NULL)::int applied, count(*) FILTER (WHERE ap.status IN ('interview','technical_interview','final_interview','offer'))::int interviews,
      round(avg(a.total_score))::int avg_score
    FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id LEFT JOIN applications ap ON ap.job_id=j.id WHERE j.user_id=$1 AND j.duplicate_of IS NULL GROUP BY j.source ORDER BY matching DESC`, [u]);
  const missing = await q(`SELECT r->>'label' AS skill, count(*)::int n FROM jobs j JOIN job_analyses a ON a.job_id=j.id, jsonb_array_elements(a.requirements) r
    WHERE j.user_id=$1 AND j.duplicate_of IS NULL AND r->>'match'='missing' AND a.eligibility->>'status' <> 'ineligible' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [u]);
  const eligibility = await q(`SELECT a.eligibility->>'status' status, count(*)::int n FROM jobs j JOIN job_analyses a ON a.job_id=j.id WHERE j.user_id=$1 AND j.duplicate_of IS NULL GROUP BY 1`, [u]);
  const scoreDist = await q(`SELECT width_bucket(a.total_score, 0, 100, 10) b, count(*)::int n FROM jobs j JOIN job_analyses a ON a.job_id=j.id WHERE j.user_id=$1 AND j.duplicate_of IS NULL GROUP BY 1 ORDER BY 1`, [u]);
  const f = funnel ?? {};
  res.json({ funnel: f, rates: { interview: f.applied ? f.interviews / f.applied : null, rejection: f.applied ? f.rejected / f.applied : null }, bySource, missing, eligibility, scoreDist });
}));
api.get('/skills/gap', wrap(async (req, res) => res.json(await skillGap(req.userId!))));

// ---------- Search & settings ----------
api.get('/sources', wrap(async (req, res) => {
  const s = await getSettings(req.userId!);
  const last = await q(`SELECT DISTINCT ON (l.source) l.source, l.status, l.fetched, l.relevant, l.inserted, l.error, l.created_at FROM source_logs l JOIN search_runs r ON r.id=l.run_id WHERE r.user_id=$1 ORDER BY l.source, l.id DESC`, [req.userId]);
  res.json(SOURCES.map(({ fetch: _f, ...x }) => ({ ...x, enabled: s.enabled_sources.includes(x.id), last: last.find((l) => l.source === x.id) ?? null })));
}));
api.post('/search/run', wrap(async (req, res) => {
  const { sources } = z.object({ sources: z.array(z.string()).optional() }).parse(req.body ?? {});
  res.json(await enqueueDiscovery(req.userId!, 'manual', sources));
}));
api.post('/search/recheck', wrap(async (req, res) => res.json(await recheckStale(req.userId!, 0, Number(req.body?.limit ?? 50)))));
api.get('/search/runs', wrap(async (req, res) => res.json(await q(`SELECT r.*, (SELECT json_agg(s ORDER BY s.id) FROM source_logs s WHERE s.run_id=r.id) AS sources FROM search_runs r WHERE r.user_id=$1 ORDER BY r.id DESC LIMIT 30`, [req.userId]))));
api.get('/search/status', wrap(async (_req, res) => res.json({ running: isDiscoveryRunning() })));
api.get('/settings', wrap(async (req, res) => {
  const s = await getSettings(req.userId!);
  const usage = await q(`SELECT task, provider, model, count(*)::int calls, sum(input_tokens)::int input_tokens, sum(output_tokens)::int output_tokens, round(sum(cost_usd)::numeric, 4) cost_usd, count(*) FILTER (WHERE NOT ok)::int errors
    FROM ai_usage WHERE user_id=$1 AND created_at >= date_trunc('month', now()) GROUP BY 1,2,3`, [req.userId]);
  res.json({ settings: s, ai: { ...aiStatus(), monthSpendUsd: await monthSpend(), usage } });
}));
api.put('/settings', wrap(async (req, res) => {
  const b = z.object({
    keywords: z.array(z.string()).min(1), levels: z.array(z.string()), employment_types: z.array(z.string()), min_salary_ngn_monthly: z.number().int().positive(), target_salary_ngn_monthly: z.number().int().positive(),
    enabled_sources: z.array(z.string()), company_boards: z.array(z.object({ ats: z.enum(['greenhouse', 'lever', 'ashby', 'workable']), slug: z.string().min(1), company: z.string().min(1) })),
    schedule_cron: z.string(), schedule_enabled: z.boolean(), max_age_days: z.number().int().min(1).max(120),
    scoring_weights: z.object({ technical: z.number(), experience: z.number(), projects: z.number(), level: z.number(), location: z.number(), salary: z.number(), freshness: z.number() }),
    fx_rates: z.record(z.string(), z.number().positive()),
  }).parse(req.body);
  const { default: cron } = await import('node-cron');
  if (!cron.validate(b.schedule_cron)) return res.status(400).json({ error: 'Invalid cron expression' });
  await q(`UPDATE search_settings SET keywords=$2, levels=$3, employment_types=$4, min_salary_ngn_monthly=$5, target_salary_ngn_monthly=$6, enabled_sources=$7, company_boards=$8, schedule_cron=$9, schedule_enabled=$10, max_age_days=$11, scoring_weights=$12, fx_rates=$13, updated_at=now() WHERE user_id=$1`,
    [req.userId, json(b.keywords), json(b.levels), json(b.employment_types), b.min_salary_ngn_monthly, b.target_salary_ngn_monthly, json(b.enabled_sources), json(b.company_boards), b.schedule_cron, b.schedule_enabled, b.max_age_days, json(b.scoring_weights), json(b.fx_rates)]);
  await scheduleDiscovery(req.userId!);
  res.json({ ok: true });
}));
api.post('/settings/fx/refresh', wrap(async (req, res) => {
  const fx = await fetchFxRates();
  if (!fx) return res.status(502).json({ error: 'Exchange-rate service unavailable; existing rates kept.' });
  await q(`UPDATE search_settings SET fx_rates=$2, fx_updated_at=now() WHERE user_id=$1`, [req.userId, json(fx)]); res.json(fx);
}));
api.post('/settings/boards/test', wrap(async (req, res) => {
  const b = z.object({ ats: z.enum(['greenhouse', 'lever', 'ashby', 'workable']), slug: z.string(), company: z.string() }).parse(req.body);
  const { BOARD_FETCHERS } = await import('../sources/ats.js');
  try { const jobs = await BOARD_FETCHERS[b.ats](b); res.json({ ok: true, jobs: jobs.length, sample: jobs.slice(0, 3).map((j) => j.title) }); }
  catch (e) { res.json({ ok: false, error: (e as Error).message }); }
}));
api.post('/admin/backup', wrap(async (_req, res) => res.json(await backupDatabase())));
export { period };
