import { skillDef } from '../lib/taxonomy.js';
import { assessEligibility, type Eligibility } from './eligibility.js';
import { extractRequirements, type Extracted, type Requirement } from './extract.js';
import type { FullProfile, Proficiency } from './profile.js';
import { analyseSalary, findSalaryInDescription, parseSalaryText, type ParsedSalary, type SalaryAnalysis } from './salary.js';

export const DEFAULT_WEIGHTS = { technical: 30, experience: 20, projects: 15, level: 10, location: 10, salary: 10, freshness: 5 };
export type Weights = typeof DEFAULT_WEIGHTS;

const PROF_CREDIT: Record<Proficiency, number> = { expert: 1, advanced: 0.95, intermediate: 0.8, basic: 0.45, learning: 0.2 };
const IMPORTANCE_W = { required: 1, mentioned: 0.6, preferred: 0.4 } as const;

export type MatchLevel = 'strong' | 'partial' | 'transferable' | 'missing';
export interface RequirementMatch extends Requirement {
  match: MatchLevel; proficiency: Proficiency | null; professional: boolean; inProjects: boolean; evidence: string | null; credit: number; note: string;
}
export interface Category { key: keyof Weights; label: string; score: number; max: number; reasons: string[] }
export interface Analysis {
  total: number; classification: string; actionable: boolean; recommendation: string; rationale: string;
  breakdown: Category[]; requirements: RequirementMatch[]; matched: string[]; partial: string[]; missing: string[];
  eligibility: Eligibility; salary: SalaryAnalysis; experience: { seniority: string; yearsRequired: number | null; yourYears: number; roleType: string; languageRequirements: string[] };
  concerns: string[]; weights: Weights; extracted: Extracted;
}

export interface JobForScoring {
  title: string; company_name: string; description_text: string | null; location_raw: string | null; location_restrictions: string[]; source: string;
  seniority: string | null; salary_min: number | null; salary_max: number | null; salary_currency: string | null; salary_period: string | null; salary_raw: string | null;
  posted_at: Date | string | null; deadline: Date | string | null; status: string; raw?: any;
  effective_published_at?: Date | string | null; publication_verified?: boolean; is_repost?: boolean; last_verified_open_at?: Date | string | null;
}

export function classify(score: number) {
  if (score >= 90) return { classification: 'Excellent match', recommendation: 'Apply immediately' };
  if (score >= 80) return { classification: 'Strong match', recommendation: 'High priority — apply' };
  if (score >= 70) return { classification: 'Good match', recommendation: 'Apply after reviewing gaps' };
  if (score >= 60) return { classification: 'Possible match', recommendation: 'Consider strategically' };
  return { classification: 'Low priority', recommendation: 'Normally skip' };
}

export function matchRequirement(r: Requirement, p: FullProfile): RequirementMatch {
  const own = p.skillMap.get(r.skill);
  const inProjects = p.projectSkills.has(r.skill);
  const inExp = p.experienceSkills.has(r.skill);
  if (own) {
    const prof = own.proficiency;
    let credit = PROF_CREDIT[prof];
    if (!own.professional && !inExp) credit *= 0.85;
    const strong = ['expert', 'advanced', 'intermediate'].includes(prof) && (own.professional || inProjects);
    const note = `${cap(prof)}${own.professional || inExp ? ', used professionally' : ', not used professionally'}${inProjects ? ', shown in projects' : ''}${own.years ? `, ~${own.years} yr` : ''}.`;
    return { ...r, match: strong ? 'strong' : 'partial', proficiency: prof, professional: own.professional || inExp, inProjects, evidence: own.evidence, credit, note };
  }
  // Transferable: a related skill the user holds at intermediate+.
  const def = skillDef(r.skill);
  const related = (def?.related ?? []).map((k) => p.skillMap.get(k)).filter((s) => s && ['expert', 'advanced', 'intermediate'].includes(s.proficiency));
  if (related.length) {
    return { ...r, match: 'transferable', proficiency: null, professional: false, inProjects: false, evidence: null, credit: 0.4, note: `Not in your profile, but transferable from ${related.map((s) => s!.label).join(', ')}.` };
  }
  return { ...r, match: 'missing', proficiency: null, professional: false, inProjects: false, evidence: null, credit: 0, note: 'Not in your profile.' };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const ROLE_FIT: Record<string, number> = { fullstack: 1, frontend: 1, general: 0.9, backend: 0.8, mobile: 0.4, qa: 0.35, ml: 0.3, data: 0.3, devops: 0.3, other: 0.3 };

/** Precomputed agent outputs; when present the scoring service uses them instead of its own baseline. */
export interface ScoringInputs { extracted?: Extracted; matches?: RequirementMatch[]; salary?: SalaryAnalysis }

export function scoreJob(job: JobForScoring, p: FullProfile, opts: { weights?: Weights; fx: Record<string, number>; minNgn: number; targetNgn: number; now?: Date; pre?: ScoringInputs }): Analysis {
  const W = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const now = opts.now ?? new Date();
  const text = job.description_text ?? '';
  const ex = opts.pre?.extracted ? { ...opts.pre.extracted } : extractRequirements(job.title, text);
  if (job.seniority && ex.seniority === 'unknown') {
    const s = job.seniority.toLowerCase();
    ex.seniority = /senior/.test(s) ? 'senior' : /entry|junior/.test(s) ? 'junior' : /mid/.test(s) ? 'mid' : 'unknown';
  }
  const reqs = opts.pre?.matches ?? ex.requirements.map((r) => matchRequirement(r, p));
  const concerns: string[] = [];
  const breakdown: Category[] = [];

  // 1) Technical skill compatibility.
  {
    const relevant = reqs.filter((r) => !['practice'].includes(skillDef(r.skill)?.category ?? '') || r.importance === 'required');
    const wsum = relevant.reduce((a, r) => a + IMPORTANCE_W[r.importance], 0);
    const got = relevant.reduce((a, r) => a + IMPORTANCE_W[r.importance] * r.credit, 0);
    const reasons: string[] = [];
    let frac: number;
    if (wsum === 0) { frac = 0.5; reasons.push('No specific technologies could be extracted from the description; neutral score given.'); concerns.push('The description lists few concrete technologies — read it yourself before applying.'); }
    else {
      frac = got / wsum;
      const strong = reqs.filter((r) => r.match === 'strong');
      const req = reqs.filter((r) => r.importance === 'required');
      reasons.push(`${strong.length} of ${reqs.length} detected technologies are strong matches.`);
      const reqMissing = req.filter((r) => r.match === 'missing');
      if (reqMissing.length) reasons.push(`Required but missing: ${reqMissing.map((r) => r.label).join(', ')}.`);
      const weak = req.filter((r) => r.match === 'partial' || r.match === 'transferable');
      if (weak.length) reasons.push(`Partial: ${weak.map((r) => `${r.label} (${r.match === 'transferable' ? 'transferable' : r.proficiency})`).join(', ')}.`);
      reasons.push('Weighted by importance: required ×1, mentioned in duties ×0.6, nice-to-have ×0.4; credit by your proficiency.');
    }
    breakdown.push({ key: 'technical', label: 'Technical skill compatibility', score: round(W.technical * frac), max: W.technical, reasons });
  }

  // 2) Relevant professional experience.
  {
    const req = reqs.filter((r) => r.importance !== 'preferred');
    const proFrac = req.length ? req.filter((r) => r.professional).length / req.length : 0.5;
    const roleFit = ROLE_FIT[ex.roleType] ?? 0.5;
    const score = W.experience * (0.6 * proFrac + 0.4 * roleFit);
    const reasons = [
      `${req.filter((r) => r.professional).length} of ${req.length} core technologies were used in paid roles.`,
      `Role type "${ex.roleType}" — ${roleFit >= 0.9 ? 'matches your target roles' : roleFit >= 0.7 ? 'adjacent to your target roles' : 'outside your main target roles'}.`,
    ];
    if (roleFit < 0.7) concerns.push(`This is a ${ex.roleType} role, which is outside your primary full-stack/frontend focus.`);
    breakdown.push({ key: 'experience', label: 'Relevant professional experience', score: round(score), max: W.experience, reasons });
  }

  // 3) Project & portfolio evidence.
  {
    const core = reqs.filter((r) => r.importance !== 'preferred' && r.match !== 'missing');
    const all = reqs.filter((r) => r.importance !== 'preferred');
    const ev = all.length ? all.filter((r) => r.inProjects || (r.evidence && r.evidence.length > 0 && !/no evidence|listed in brief/i.test(r.evidence))).length / all.length : 0.5;
    const reasons = [`${core.filter((r) => r.inProjects).length} of ${all.length} core technologies appear in your portfolio projects; ${Math.round(ev * 100)}% have documented evidence.`];
    const projMatches = p.projects.filter((pr: any) => (pr.technologies ?? []).some((t: string) => all.some((r) => r.skill === t))).map((pr: any) => pr.name);
    if (projMatches.length) reasons.push(`Most relevant projects: ${projMatches.slice(0, 3).join(', ')}.`);
    breakdown.push({ key: 'projects', label: 'Project & portfolio evidence', score: round(W.projects * ev), max: W.projects, reasons });
  }

  // 4) Experience-level compatibility (target: mid-level).
  {
    const yrs = p.professionalYears;
    let f = 0.8; const reasons: string[] = [];
    switch (ex.seniority) {
      case 'mid': f = 1; reasons.push('Mid-level role — matches your target level.'); break;
      case 'unknown': f = 0.85; reasons.push('Seniority not stated in title.'); break;
      case 'junior': f = 0.7; reasons.push('Junior role — below your target level (you may be over-qualified; pay may be lower).'); break;
      case 'intern': f = 0.2; reasons.push('Internship — well below your level.'); break;
      case 'senior': f = 0.55; reasons.push('Senior title — a stretch from mid-level, but often achievable with strong evidence.'); break;
      case 'lead': f = 0.45; reasons.push('Lead role — you have team-lead experience at Luvie; check scope.'); break;
      case 'staff': f = 0.1; reasons.push('Staff/principal level — well above your current level.'); break;
    }
    if (ex.yearsMin !== null) {
      const gap = ex.yearsMin - yrs;
      if (gap <= 0) { f = Math.min(1, f + 0.15); reasons.push(`Requires ${ex.yearsMin}+ years; you have ~${yrs}.`); }
      else if (gap <= 1.5) { f = Math.min(f, 0.7); reasons.push(`Requires ${ex.yearsMin}+ years; you have ~${yrs} (small gap).`); concerns.push(`Asks for ${ex.yearsMin}+ years; you have about ${yrs}.`); }
      else { f = Math.min(f, 0.35); reasons.push(`Requires ${ex.yearsMin}+ years; you have ~${yrs} (significant gap).`); concerns.push(`Asks for ${ex.yearsMin}+ years — ${Math.round(gap)} more than you have.`); }
    }
    if (ex.seniority === 'senior' && ex.yearsMin === null) concerns.push('Senior title: emphasise ownership (Luvie lead, Routta architecture).');
    if (ex.seniority === 'staff') concerns.push('Staff/principal level is unrealistic at this stage.');
    breakdown.push({ key: 'level', label: 'Experience-level compatibility', score: round(W.level * f), max: W.level, reasons });
  }

  // 5) Location & work eligibility (hard gate).
  const elig = assessEligibility({ title: job.title, locationRaw: job.location_raw, locationRestrictions: job.location_restrictions, timezoneRestrictions: job.raw?.timezoneRestrictions, description: text, source: job.source });
  {
    const f = { eligible: 1, likely: 0.7, unknown: 0.4, ineligible: 0 }[elig.status];
    breakdown.push({ key: 'location', label: 'Location & work eligibility', score: round(W.location * f), max: W.location, reasons: [elig.summary, ...elig.evidence.slice(0, 4).map((e) => `${e.effect === 'positive' ? '✓' : e.effect === 'negative' ? '✗' : '•'} ${e.text}`)] });
    if (elig.status === 'unknown') concerns.push('Nigeria eligibility is not stated — confirm with the employer before investing time.');
    if (elig.status === 'likely') concerns.push('Nigeria eligibility is inferred, not explicit.');
  }
  if (ex.languageRequirements.length) concerns.push(`Requires fluency in ${ex.languageRequirements.join(', ')}.`);
  if (ex.clearance) concerns.push('Security clearance / citizenship requirement.');

  // 6) Salary compatibility.
  let parsed: ParsedSalary | null = job.salary_min ? { min: job.salary_min, max: job.salary_max, currency: job.salary_currency, period: (job.salary_period as any) ?? 'year', raw: job.salary_raw, source: 'listing' } : null;
  if (!parsed) parsed = parseSalaryText(job.salary_raw, 'listing') ?? findSalaryInDescription(text);
  const sal = opts.pre?.salary ?? analyseSalary(parsed, opts.fx, opts.minNgn, opts.targetNgn);
  breakdown.push({ key: 'salary', label: 'Salary compatibility', score: round(W.salary * sal.score01), max: W.salary, reasons: [sal.original ? `${sal.original} ≈ ₦${(sal.ngnMonthlyMin ?? 0).toLocaleString()}${sal.ngnMonthlyMax && sal.ngnMonthlyMax !== sal.ngnMonthlyMin ? '–₦' + sal.ngnMonthlyMax.toLocaleString() : ''}/month (est.)` : 'Salary not disclosed — neutral score.', sal.note] });
  if (sal.status === 'below_minimum') concerns.push('Advertised pay is below your ₦500k/month minimum.');

  // 7) Freshness & availability.
  {
    // Repost-resistant date: the official ATS date or the earliest sighting, never a re-dated aggregator copy.
    const pd = job.effective_published_at ?? job.posted_at;
    const posted = pd ? new Date(pd) : null;
    const age = posted ? (now.getTime() - posted.getTime()) / 864e5 : null;
    const deadline = job.deadline ? new Date(job.deadline) : null;
    let f: number; const reasons: string[] = [];
    if (job.status === 'expired') { f = 0; reasons.push('Listing is no longer open.'); }
    else if (deadline && deadline < now) { f = 0; reasons.push('Application deadline has passed.'); }
    else if (age === null) { f = 0.5; reasons.push('Posting date unknown.'); }
    else { f = age <= 1 ? 1 : age <= 3 ? 0.9 : age <= 7 ? 0.75 : age <= 14 ? 0.55 : age <= 30 ? 0.35 : 0.1; reasons.push(`Published ${Math.max(0, Math.round(age))} day(s) ago${job.publication_verified ? ' (date verified on the employer ATS)' : ' (publication date unverified)'}.`); }
    if (job.is_repost) reasons.push('Re-listed vacancy — not treated as new.');
    breakdown.push({ key: 'freshness', label: 'Job freshness & availability', score: round(W.freshness * f), max: W.freshness, reasons });
  }

  let total = Math.round(breakdown.reduce((a, c) => a + c.score, 0) * (100 / Object.values(W).reduce((a, b) => a + b, 0)));
  let actionable = true;
  // Hard gates.
  if (elig.status === 'ineligible') { total = Math.min(total, 35); actionable = false; concerns.unshift('Not open to candidates working from Nigeria — score capped at 35.'); }
  else if (elig.status === 'unknown') { total = Math.min(total, 74); }
  if (job.status === 'expired') { actionable = false; total = Math.min(total, 40); }
  if (ex.clearance || ex.languageRequirements.length) total = Math.min(total, 55);
  if (ex.seniority === 'staff' || ex.seniority === 'intern') total = Math.min(total, 55);
  // Older than 30 days: excluded from recommendations unless verified still open recently.
  {
    const pd = job.effective_published_at ?? job.posted_at;
    const age = pd ? (now.getTime() - new Date(pd).getTime()) / 864e5 : null;
    const verifiedOpen = job.last_verified_open_at && now.getTime() - new Date(job.last_verified_open_at).getTime() < 48 * 3600e3;
    if (age !== null && age > 30) {
      if (!verifiedOpen) { total = Math.min(total, 69); concerns.push(`Published ${Math.round(age)} days ago and not verified open recently — kept out of recommendations.`); }
      else concerns.push(`Published ${Math.round(age)} days ago, but verified open on ${new Date(job.last_verified_open_at!).toISOString().slice(0, 10)}.`);
    }
  }

  const { classification, recommendation } = classify(total);
  const matched = reqs.filter((r) => r.match === 'strong').map((r) => r.label);
  const partial = reqs.filter((r) => r.match === 'partial' || r.match === 'transferable').map((r) => r.label);
  const missing = reqs.filter((r) => r.match === 'missing').map((r) => r.label);
  const reqMissing = reqs.filter((r) => r.match === 'missing' && r.importance === 'required').map((r) => r.label);
  const rationale = [
    `${classification} (${total}/100).`,
    matched.length ? `You match ${matched.slice(0, 6).join(', ')}.` : 'Few direct technology matches.',
    reqMissing.length ? `Missing required: ${reqMissing.join(', ')}.` : missing.length ? `Gaps are in nice-to-haves (${missing.slice(0, 4).join(', ')}).` : 'No missing technologies detected.',
    `Eligibility: ${elig.status}.`,
    !actionable ? 'Not actionable.' : '',
  ].filter(Boolean).join(' ');

  return {
    total, classification, actionable, recommendation: actionable ? recommendation : 'Skip — not eligible/available', rationale, breakdown, requirements: reqs,
    matched, partial, missing, eligibility: elig, salary: sal,
    experience: { seniority: ex.seniority, yearsRequired: ex.yearsMin, yourYears: p.professionalYears, roleType: ex.roleType, languageRequirements: ex.languageRequirements },
    concerns: [...new Set(concerns)], weights: W, extracted: ex,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
