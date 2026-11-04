import { json, one, q } from '../db.js';
import { saveDoc } from '../docs/generate.js';
import { qaDocument } from '../docs/qa.js';
import { loadProfile } from '../engine/profile.js';
import { computeFreshness } from '../engine/freshness.js';
import { getAutomation, recordEvent, tierFor } from '../engine/policy.js';
import { recheckJob } from '../engine/recheck.js';
import { saveResearch } from '../engine/research.js';
import { analyseJob } from '../engine/store.js';
import { SKILLS } from '../lib/taxonomy.js';
import { registerWorkflow, startWorkflow, type StepState, type Workflow } from './core/orchestrator.js';

/**
 * Workflow definitions (DAGs). Agents never call each other: each step's input is built from upstream
 * structured outputs, and deterministic services (scoring, policy, persistence, QA) sit between them.
 */
const job = async (s: StepState) => (s.results.__job ??= await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [s.params.jobId, s.userId]));

/** Persist documents with QA results and evidence references. */
async function persistDocuments(s: StepState) {
  const j = await job(s);
  const p = await loadProfile(s.userId);
  const refs = (p.evidence?.refs ?? []).map((r) => r.claimId);
  const out: Record<string, any> = {};
  const save = async (kind: 'cv' | 'cover_letter' | 'email' | 'answers', title: string, content: any, engine: string, warnings: string[], attachments?: { kind: string; ok: boolean }[]) => {
    const qa = qaDocument(kind, content, { p, job: j, attachments });
    const d = await saveDoc(s.userId, j.id, kind, title, content, engine, [...warnings, ...qa.errors.map((e) => `QA: ${e}`)]);
    await q(`UPDATE documents SET qa=$2, evidence_refs=$3 WHERE id=$1`, [d.id, json(qa), json(refs)]);
    out[kind] = { id: d.id, qa };
  };
  const cv = s.results.cv; const cover = s.results.cover;
  if (cv) await save('cv', `CV — ${j.title} @ ${j.company_name}`, cv.content, cv.aiSummary ? 'mixed' : 'rules-v1', cv.warnings);
  if (cover) {
    await save('cover_letter', `Cover letter — ${j.title} @ ${j.company_name}`, cover.coverLetter, 'mixed', cover.warnings);
    await save('answers', `Screening answers — ${j.title}`, cover.answers, 'rules-v1', []);
    await save('email', `Email — ${j.title}`, cover.email, 'rules-v1', cover.email.to ? [] : ['No verified application email.'],
      [{ kind: 'CV', ok: !!out.cv?.qa.passed }, { kind: 'Cover letter', ok: !!out.cover_letter?.qa.passed }]);
  }
  const qaPassed = Object.values(out).every((d: any) => d.qa.passed);
  return { cvId: out.cv?.id ?? null, coverLetterId: out.cover_letter?.id ?? null, emailId: out.email?.id ?? null, answersId: out.answers?.id ?? null, qaPassed, qa: Object.fromEntries(Object.entries(out).map(([k, v]: any) => [k, { passed: v.qa.passed, submittable: v.qa.submittable, errors: v.qa.errors }])) };
}

/**
 * Opportunity pipeline: verify → understand → research (parallel) → score → tier → documents → (priority) execute → track → notify.
 */
export const opportunityWorkflow: Workflow = {
  name: 'opportunity',
  description: 'Full pipeline for one vacancy: re-verify open, extract, research company/application and salary in parallel, score, tier, prepare documents, attempt submission for priority matches if permitted, track and notify.',
  subject: 'job',
  steps: [
    { id: 'recheck', service: { name: 'recheck', run: async (s) => { await job(s); const r = await recheckJob(s.userId, s.params.jobId); await computeFreshness(s.params.jobId); return r; } } },
    {
      id: 'extraction', agent: 'jd-extraction', needs: [{ step: 'recheck' }],
      when: (s) => s.results.recheck.status !== 'expired',
      input: (s) => ({ jobId: s.params.jobId, title: s.results.__job?.title ?? '', description: s.results.__job?.description_text ?? '', taxonomyKeys: SKILLS.map((k) => k.key) }),
      persist: async (s, o) => { await q(`INSERT INTO job_extractions (job_id, data, engine) VALUES ($1,$2,'agent') ON CONFLICT (job_id) DO UPDATE SET data=$2, extracted_at=now()`, [s.params.jobId, json(o)]); },
    },
    {
      id: 'company', agent: 'company-research', needs: [{ step: 'recheck' }],
      when: (s) => s.results.recheck.status !== 'expired',
      input: (s) => { const j = s.results.__job; return { jobId: j.id, companyId: j.company_id, company: j.company_name, knownWebsite: null, aboutSection: null, listingUrl: j.source_url }; },
    },
    {
      id: 'appResearch', agent: 'application-research', needs: [{ step: 'company', optional: true }, { step: 'extraction', optional: true }],
      when: (s) => s.results.recheck.status !== 'expired',
      input: (s) => ({ jobId: s.params.jobId, website: s.results.company?.website ?? null, applicationInstructions: s.results.extraction?.applicationInstructions ?? [] }),
      persist: async (_s, o) => { await saveResearch(o.row.job_id ?? _s.params.jobId, o); },
    },
    { id: 'matching', agent: 'skill-matching', needs: [{ step: 'extraction' }], input: (s) => ({ jobId: s.params.jobId, requirements: s.results.extraction.requirements, otherRequirements: s.results.extraction.otherRequirements }) },
    {
      id: 'salary', agent: 'salary-analysis', needs: [{ step: 'extraction' }],
      input: (s) => { const j = s.results.__job; return { jobId: j.id, structured: { min: j.salary_min, max: j.salary_max, currency: j.salary_currency, period: j.salary_period, raw: j.salary_raw }, salaryStatements: s.results.extraction.salaryStatements, description: j.description_text ?? '' }; },
    },
    {
      id: 'score', needs: [{ step: 'matching' }, { step: 'salary', optional: true }, { step: 'appResearch', optional: true }],
      service: {
        name: 'scoring', run: async (s) => {
          await computeFreshness(s.params.jobId);
          const a = await analyseJob(s.userId, s.params.jobId, undefined, { extracted: s.results.extraction, matches: s.results.matching.matches, salary: s.results.salary });
          const tier = tierFor(a.total);
          await recordEvent(s.userId, s.params.jobId, 'analysed', `Scored ${a.total}/100 (${a.classification}); eligibility ${a.eligibility.status}`, 'service:scoring', { score: a.total });
          return { total: a.total, tier, actionable: a.actionable, classification: a.classification, eligibility: a.eligibility.status, requirements: a.requirements, analysis: { requirements: a.requirements, experience: { responsibilities: a.extracted.responsibilities } } };
        },
      },
    },
    {
      id: 'cv', agent: 'cv-generation', needs: [{ step: 'score' }],
      when: async (s) => !!s.params.forceDocs || (s.results.score.actionable && s.results.score.total >= (await getAutomation(s.userId)).docs_min_score),
      input: (s) => { const j = s.results.__job; return { jobId: j.id, job: { id: j.id, title: j.title, company_name: j.company_name, description_text: j.description_text }, matches: s.results.score.requirements }; },
    },
    {
      id: 'cover', agent: 'cover-letter', needs: [{ step: 'score' }, { step: 'appResearch', optional: true }],
      when: async (s) => !!s.params.forceDocs || (s.results.score.actionable && s.results.score.total >= (await getAutomation(s.userId)).docs_min_score),
      input: (s) => ({ jobId: s.params.jobId, job: s.results.__job, analysis: s.results.score.analysis, research: s.results.appResearch?.row ?? null }),
    },
    { id: 'documents', needs: [{ step: 'cv' }, { step: 'cover', optional: true }], service: { name: 'documents+qa', run: persistDocuments } },
    {
      id: 'execute', agent: 'application-execution', needs: [{ step: 'documents' }],
      // A manual "prepare" run never submits; automatic runs try only at or above your auto-apply minimum (and only if every check passes).
      when: async (s) => !s.params.manual && Number(s.results.score.total ?? 0) >= (await getAutomation(s.userId)).auto_apply_min_score,
      input: (s) => ({ jobId: s.params.jobId, requestedBy: 'auto' }),
    },
    {
      id: 'track', agent: 'tracking', needs: [{ step: 'score', optional: true }, { step: 'documents', optional: true }, { step: 'execute', optional: true }, { step: 'recheck' }],
      input: (s) => ({
        jobId: s.params.jobId, score: s.results.score?.total ?? 0, tier: s.results.score?.tier ?? 'store', actionable: s.results.score?.actionable ?? false,
        documents: s.results.documents ? { cvId: s.results.documents.cvId, coverLetterId: s.results.documents.coverLetterId, qaPassed: s.results.documents.qaPassed } : null,
        attempt: s.results.execute ? { attemptId: s.results.execute.attemptId, status: s.results.execute.status, reason: s.results.execute.reason } : null,
        expired: s.results.recheck?.status === 'expired',
      }),
    },
    {
      id: 'notify', agent: 'notification', needs: [{ step: 'track' }],
      when: async (s) => !s.params.manual && !!s.results.score && s.results.score.actionable && s.results.score.total >= (await getAutomation(s.userId)).notify_min_score,
      input: (s) => ({ jobId: s.params.jobId, kind: s.results.execute ? 'application_result' : 'opportunity', attemptId: s.results.execute?.attemptId ?? null }),
    },
    {
      // Separate, explicit alert when an email application was blocked only because the sender isn't configured.
      id: 'notifyConfig', agent: 'notification', needs: [{ step: 'execute' }],
      when: (s) => /job-application sender is not ready/.test(s.results.execute?.reason ?? ''),
      input: (s) => ({ jobId: s.params.jobId, kind: 'config_required', attemptId: s.results.execute?.attemptId ?? null }),
    },
  ],
};

/** The user pressed "Approve & send" for one job: re-run all checks, then execute, track and notify. */
export const applyWorkflow: Workflow = {
  name: 'apply',
  description: 'User-approved application attempt for one vacancy (all policy checks re-run).',
  subject: 'job',
  steps: [
    { id: 'recheck', service: { name: 'recheck', run: async (s) => { await job(s); const r = await recheckJob(s.userId, s.params.jobId); await computeFreshness(s.params.jobId); return r; } } },
    { id: 'execute', agent: 'application-execution', needs: [{ step: 'recheck' }], input: (s) => ({ jobId: s.params.jobId, requestedBy: 'user' }) },
    {
      id: 'track', agent: 'tracking', needs: [{ step: 'execute' }],
      input: async (s) => {
        const a = await one(`SELECT total_score, actionable FROM job_analyses WHERE job_id=$1`, [s.params.jobId]);
        const score = Number(a?.total_score ?? 0);
        return { jobId: s.params.jobId, score, tier: tierFor(score), actionable: !!a?.actionable, documents: null,
          attempt: { attemptId: s.results.execute.attemptId, status: s.results.execute.status, reason: s.results.execute.reason } };
      },
    },
    { id: 'notify', agent: 'notification', needs: [{ step: 'track' }], input: (s) => ({ jobId: s.params.jobId, kind: 'application_result', attemptId: s.results.execute.attemptId }) },
    {
      id: 'notifyConfig', agent: 'notification', needs: [{ step: 'execute' }],
      when: (s) => /job-application sender is not ready/.test(s.results.execute?.reason ?? ''),
      input: (s) => ({ jobId: s.params.jobId, kind: 'config_required', attemptId: s.results.execute?.attemptId ?? null }),
    },
  ],
};

/** Discovery: search all sources, then fan out the opportunity pipeline for new/updated relevant jobs. */
export const discoveryWorkflow: Workflow = {
  name: 'discovery',
  description: 'Search every enabled source, store real vacancies, then queue the opportunity pipeline for the most promising new ones.',
  subject: 'user',
  steps: [
    { id: 'discover', agent: 'job-discovery', input: (s) => ({ trigger: s.params.trigger ?? 'manual', sources: s.params.sources }) },
    {
      id: 'fanout', needs: [{ step: 'discover' }],
      service: {
        name: 'fan-out', run: async (s) => {
          const ids: number[] = s.results.discover.newJobIds ?? [];
          // Triage by the fast deterministic score; run the full pipeline for those worth notifying about.
          const auto = await getAutomation(s.userId);
          const rows = ids.length ? await q<{ job_id: number; total_score: number }>(`SELECT job_id, total_score FROM job_analyses WHERE job_id = ANY($1) AND actionable AND total_score >= $2 ORDER BY total_score DESC LIMIT 25`, [ids, Math.min(auto.notify_min_score, 50)]) : [];
          const runs = [];
          for (const r of rows) runs.push(await startWorkflow(s.userId, 'opportunity', { jobId: r.job_id }, 'discovery'));
          return { queued: runs.length, runIds: runs };
        },
      },
    },
    { id: 'skillGap', agent: 'skill-gap', needs: [{ step: 'discover' }], input: () => ({}) },
  ],
};

export const profileRefreshWorkflow: Workflow = {
  name: 'profile-refresh',
  description: 'Re-read GitHub and the portfolio for new evidence; produces suggestions only.',
  subject: 'user',
  steps: [
    {
      id: 'profile', agent: 'profile-intelligence',
      input: async (s) => {
        const p = await one(`SELECT links FROM profiles WHERE user_id=$1`, [s.userId]);
        const gh = /github\.com\/([^/?#]+)/.exec(p?.links?.github ?? '')?.[1] ?? null;
        return { githubUser: gh, portfolioUrl: p?.links?.portfolio ?? null };
      },
      persist: async (s, o) => { for (const x of o.suggestions) await q(`INSERT INTO profile_suggestions (user_id, kind, payload, evidence, source_url) VALUES ($1,$2,$3,$4,$5)`, [s.userId, x.kind, json(x.payload), x.evidence, x.sourceUrl]); },
    },
  ],
};

export function registerWorkflows() {
  for (const w of [opportunityWorkflow, applyWorkflow, discoveryWorkflow, profileRefreshWorkflow]) registerWorkflow(w);
}

