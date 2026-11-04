import { complete, aiStatus } from '../ai/provider.js';
import { json, one, q } from '../db.js';
import { detectSkills, labelOf, skillDef } from '../lib/taxonomy.js';
import { loadProfile, type FullProfile } from '../engine/profile.js';
import { getSettings } from '../engine/settings.js';
import type { RequirementMatch } from '../engine/scoring.js';
import { pick, STYLE_GUIDE } from './style.js';

/**
 * Application Document Agents (CV, cover letter, email, screening answers, intro).
 * Truthfulness rules enforced in code:
 *  - every skill/experience/project comes from the master profile
 *  - a guard scans the output for technologies NOT in the profile and strips/flags them
 *  - unknown personal facts become clearly marked [PLACEHOLDERS]
 */

export interface CvContent {
  header: { name: string; headline: string; location: string; email: string; phone: string; links: Record<string, string> };
  summary: string;
  skills: { group: string; items: string[] }[];
  experience: { company: string; title: string; period: string; bullets: string[] }[];
  projects: { name: string; url: string | null; description: string; technologies: string[] }[];
  education: { institution: string; credential: string | null; period: string | null }[];
  meta: { jobId: number | null; targetTitle: string; company: string; keywords: string[]; omittedSkills: string[] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d: string | null) {
  if (!d) return '';
  const [y, m] = d.split('-');
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : y;
}
const article = (t: string) => (/^[aeiou]/i.test(t) ? 'an' : 'a');
const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
export const period = (e: any) => e.datesText ? e.datesText : `${fmtDate(e.start_date) || '[START DATE]'} – ${e.is_current ? 'Present' : fmtDate(e.end_date) || '[END DATE]'}`;

const GROUPS: [string, string[]][] = [
  ['Languages', ['language']], ['Frontend', ['frontend', 'mobile', 'design']], ['Backend & APIs', ['backend', 'architecture']],
  ['Data', ['data']], ['Cloud & DevOps', ['cloud', 'devops', 'tooling']], ['AI', ['ai']], ['Practices', ['practice', 'quality']],
];

/** Return taxonomy skills mentioned in text that the profile does not contain. */
export function unsupportedSkills(text: string, p: FullProfile): string[] {
  const allowed = new Set([...p.skillMap.keys(), ...p.projectSkills, ...p.experienceSkills]);
  // Allow implied parents (e.g. TypeScript implies JavaScript); allow "sql" if postgresql present.
  if (allowed.has('postgresql')) allowed.add('sql');
  if (allowed.has('typescript')) allowed.add('javascript');
  if (allowed.has('vue_composition')) allowed.add('vue');
  return [...detectSkills(text).keys()].filter((k) => !allowed.has(k));
}

function relevanceOf(text: string, wanted: Set<string>) {
  let s = 0; for (const k of detectSkills(text).keys()) if (wanted.has(k)) s++; return s;
}

export function buildCv(p: FullProfile, job: any | null, reqs: RequirementMatch[]): CvContent {
  const wanted = new Set(reqs.filter((r) => r.match !== 'missing').map((r) => r.skill));
  const order = new Map(reqs.map((r, i) => [r.skill, i]));
  const roleType = job ? (/full[\s-]?stack/i.test(job.title) ? 'Full-Stack' : /front/i.test(job.title) ? 'Frontend' : /back/i.test(job.title) ? 'Backend' : null) : null;
  const topMatched = reqs.filter((r) => r.match === 'strong').slice(0, 3).map((r) => r.label);
  const headline = job
    ? `${roleType ? `${roleType} Software Engineer` : 'Software Engineer'}${topMatched.length ? ' | ' + topMatched.join(' · ') : ''}`
    : p.profile.headline;

  // Skills: matched first (in the job's order of importance), then remaining intermediate+ skills; basics only if the job asks.
  const skills = [...p.skills].filter((s) => s.proficiency !== 'learning' && (s.proficiency !== 'basic' || wanted.has(s.name)));
  skills.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));
  const solid = skills.filter((s) => s.proficiency !== 'basic');
  const grouped = GROUPS.map(([group, cats]) => ({ group, items: solid.filter((s) => cats.includes(s.category)).map((s) => s.label) })).filter((g) => g.items.length);
  if (job) grouped.sort((a, b) => b.items.filter((i) => topMatched.includes(i)).length - a.items.filter((i) => topMatched.includes(i)).length);
  // Basic-level skills the job asks for are listed honestly as "Familiar with", never alongside core skills.
  const familiar = skills.filter((s) => s.proficiency === 'basic').map((s) => s.label);
  if (familiar.length) grouped.push({ group: 'Familiar with', items: familiar });

  // Experience: reverse-chronological (truthful), bullets reordered by relevance; low-relevance older roles condensed.
  const exps = p.experiences.map((e: any) => {
    const bullets: string[] = [...(e.bullets ?? [])].sort((a, b) => relevanceOf(b, wanted) - relevanceOf(a, wanted));
    const rel = (e.technologies ?? []).filter((t: string) => wanted.has(t)).length;
    return { company: e.company, title: e.title, period: period(e), bullets: job && rel === 0 ? bullets.slice(0, 2) : bullets, rel };
  });

  // Projects: top 3 by technology overlap.
  const projects = [...p.projects]
    .map((pr: any) => ({ pr, s: (pr.technologies ?? []).filter((t: string) => wanted.has(t)).length + relevanceOf(`${pr.contribution} ${pr.problem}`, wanted) * 0.5 }))
    .sort((a, b) => b.s - a.s).slice(0, 3)
    .map(({ pr }) => ({ name: pr.name, url: pr.url, description: `${pr.problem ?? ''} ${pr.contribution ?? ''}`.trim(), technologies: (pr.technologies ?? []).map(labelOf) }));

  const yrs = Math.max(1, Math.floor(p.professionalYears));
  const strongest = (topMatched.length ? topMatched : p.skills.filter((s) => ['expert', 'advanced'].includes(s.proficiency)).slice(0, 4).map((s) => s.label));
  const current = p.experiences.find((e: any) => e.is_current);
  const summary = [
    `Software engineer with ${yrs}+ years of professional experience building production web applications${p.skillMap.has('nodejs') ? ', REST APIs' : ''} and SaaS dashboards.`,
    current ? `Currently ${/lead/i.test(current.title) ? 'leading full-stack engineering' : `working as ${article(current.title)} ${current.title}`} at ${current.company}${current.description ? ` (${current.description.replace(/\.$/, '')})` : ''}.` : '',
    `Strongest in ${strongest.join(', ')}${job ? `, which map directly to the ${job.title} role at ${job.company_name}` : ''}.`,
    'Works fully remotely from Nigeria (UTC+1).',
  ].filter(Boolean).join(' ').replace(/\.\.(?=\s|$)/g, '.');

  return {
    header: { name: p.profile.full_name, headline, location: 'Nigeria · Remote', email: p.profile.email, phone: p.profile.phone, links: p.profile.links },
    summary, skills: grouped, experience: exps.map(({ rel: _r, ...e }) => e), projects,
    education: p.education.map((e: any) => ({ institution: e.institution, credential: e.credential, period: e.period })),
    meta: { jobId: job?.id ?? null, targetTitle: job?.title ?? 'Master CV', company: job?.company_name ?? '', keywords: [...wanted].map(labelOf), omittedSkills: reqs.filter((r) => r.match === 'missing').map((r) => r.label) },
  };
}

function cvText(c: CvContent) {
  return [c.summary, ...c.skills.flatMap((s) => s.items), ...c.experience.flatMap((e) => e.bullets), ...c.projects.map((p) => p.description)].join('\n');
}

export function buildCoverLetter(p: FullProfile, job: any, analysis: any, research: any | null): { paragraphs: string[]; signoff: string } {
  const reqs: RequirementMatch[] = analysis.requirements ?? [];
  const strong = reqs.filter((r) => r.match === 'strong').slice(0, 4).map((r) => r.label);
  const transferable = reqs.filter((r) => r.match === 'transferable' && r.importance !== 'preferred').slice(0, 2);
  const missingReq = reqs.filter((r) => r.match === 'missing' && r.importance === 'required').slice(0, 2);
  const responsibilities: string[] = analysis.experience?.responsibilities ?? [];
  const resp = responsibilities.find((r) => r.length > 30 && r.length < 160 && relevanceOf(r, new Set(reqs.filter((x) => x.match === 'strong').map((x) => x.skill))) > 0) ?? responsibilities.find((r) => r.length > 30 && r.length < 160);
  const current = p.experiences.find((e: any) => e.is_current && /lead|full/i.test(e.title)) ?? p.experiences[0];
  const wanted = new Set(reqs.filter((r) => r.match !== 'missing').map((r) => r.skill));
  const proj = [...p.projects].sort((a: any, b: any) => (b.technologies ?? []).filter((t: string) => wanted.has(t)).length - (a.technologies ?? []).filter((t: string) => wanted.has(t)).length)[0];
  // Only an employer whose evidence includes the Composition API may be cited for it.
  const vue = p.experiences.find((e: any) => (e.technologies ?? []).includes('vue_composition') && e !== current);

  const paras = [
    pick(job.id ?? 0, [
      `I'm applying for the ${job.title} position at ${job.company_name}.${resp ? ` The part of the role that stood out to me is “${resp.replace(/\.$/, '')}”, which is close to the work I do every week.` : ''}`,
      `I'd like to apply for the ${job.title} role at ${job.company_name}.${resp ? ` Your listing mentions “${resp.replace(/\.$/, '')}”, and that is a large part of what I already do.` : ''}`,
      `Please consider this my application for the ${job.title} role at ${job.company_name}.${resp ? ` I read “${resp.replace(/\.$/, '')}” in the description and it lines up with my current work.` : ''}`,
    ]),
    `${current ? `At ${current.company} I ${/lead/i.test(current.title) ? 'lead full-stack engineering' : `work as ${article(current.title)} ${current.title}`}. In that role I ${(current.bullets ?? []).slice(1, 3).map((b: string) => b.charAt(0).toLowerCase() + b.slice(1).replace(/\.$/, '')).join(', and I ')}.` : ''}${strong.length ? ` Of the skills you list, the ones I use most are ${strong.slice(0, -1).join(', ')}${strong.length > 1 ? ' and ' : ''}${strong[strong.length - 1]}.` : ''}${vue && wanted.has('vue') ? ` At ${vue.company} I built Vue 3 interfaces with the Composition API.` : ''}`,
    proj ? `A relevant example is ${proj.name}: ${lowerFirst((proj.contribution ?? '').replace(/\.$/, ''))}.${proj.url ? ` You can see it at ${proj.url}.` : ''}` : '',
    transferable.length || missingReq.length
      ? `To be straightforward about gaps: ${[...transferable.map((t) => `I haven't used ${t.label} in production, but ${t.note.replace(/^Not in your profile, but transferable from /, 'I work daily with ').replace(/\.$/, '')}`), ...missingReq.map((m) => `${m.label} would be new to me`)].join('; ')}. I'm happy to talk through how I'd close that gap.`
      : '',
    `I work fully remotely from Nigeria (UTC+1), which overlaps with European hours and the US morning. My portfolio is at ${p.profile.links?.portfolio ?? ''} and my code is on ${p.profile.links?.github ?? ''}. ${pick((job.id ?? 0) + 1, [`I'd be glad to talk about the role.`, `I'd welcome a conversation about the work at ${job.company_name}.`, `Happy to share more detail on any of this.`])}`,
  ].filter((x) => x && x.trim()).map((x) => x.replace(/\.\.(?=\s|$)/g, '.'));
  void research;
  return { paragraphs: paras, signoff: `Kind regards,\n${p.profile.full_name}\n${p.profile.email} · ${p.profile.phone}` };
}

export async function buildAnswers(p: FullProfile, job: any, research: any | null, userId: number) {
  const s = await getSettings(userId);
  const ccy = job.salary_currency ?? 'USD';
  const rate = s.fx_rates[ccy];
  const fmt = (n: number) => n.toLocaleString('en-US');
  const minC = rate ? Math.round(Number(s.min_salary_ngn_monthly) / rate) : null;
  const tgtC = rate ? Math.round(Number(s.target_salary_ngn_monthly) / rate) : null;
  const salaryAns = minC && tgtC && ccy !== 'NGN'
    ? `[REVIEW] I'm targeting at least ${ccy} ${fmt(tgtC)}/month (≈ ₦${fmt(Number(s.target_salary_ngn_monthly))}), with a floor of ${ccy} ${fmt(minC)}/month, and I'm open to discussing the full package for this role.`
    : `[REVIEW] I'm targeting ₦${fmt(Number(s.target_salary_ngn_monthly))}/month or more and I'm open to discussing the full package.`;
  const notice = p.profile.availability ? p.profile.availability : '[ADD YOUR NOTICE PERIOD / START DATE]';
  const L = p.profile.links ?? {};
  const cur = p.experiences.find((e: any) => e.is_current);
  const stack = p.skills.filter((k) => ['expert', 'advanced'].includes(k.proficiency)).slice(0, 5).map((k) => k.label);
  const intro = `I'm ${p.profile.full_name.split(' ').slice(0, 2).reverse().join(' ')}, a software engineer based in Nigeria working remotely. I build production web apps${stack.length ? ` with ${stack.join(', ')}` : ''}${cur ? `, and I currently work as ${article(cur.title)} ${cur.title} at ${cur.company}${cur.description ? ` (${String(cur.description).replace(/\.$/, '')})` : ''}` : ''}.`;

  const known: [RegExp, string][] = [
    [/^first name/i, p.profile.full_name.split(' ')[0]],
    [/^last name/i, p.profile.full_name.split(' ').slice(1).join(' ')],
    [/^(full )?name$/i, p.profile.full_name],
    [/preferred name|name you'?d prefer/i, '[CONFIRM] Muritala'],
    [/^email/i, p.profile.email],
    [/^phone/i, p.profile.phone],
    [/linkedin/i, L.linkedin ?? '[ADD LINKEDIN]'],
    [/github/i, L.github ?? '[ADD GITHUB]'],
    [/portfolio|website|personal site/i, L.portfolio ?? '[ADD PORTFOLIO]'],
    [/country.*(located|reside|live)|where are you (based|located)|location/i, 'Nigeria'],
    [/sponsor|visa/i, '[REVIEW] I do not require visa sponsorship to work remotely from Nigeria. I would need to be engaged as a remote employee (e.g. via an employer-of-record) or as a contractor.'],
    [/authori[sz]ed to work/i, '[REVIEW] I am authorised to work in Nigeria. I am not authorised to work in other countries without sponsorship.'],
    [/salary|compensation|pay expectation/i, salaryAns],
    [/notice|start date|when can you start|availability/i, notice],
    [/employment agreements|non-?compete|post-employment restrictions/i, '[CONFIRM WITH YOUR CONTRACTS] No — I am not aware of any agreements that would restrict me from this role.'],
    [/how did you hear|source/i, research?.discovered_on ? `Job listing on ${research.discovered_on}` : '[ADD]'],
    [/years of (professional )?experience/i, `${Math.floor(p.professionalYears)}+ years of professional software engineering experience`],
    [/why .*(join|work|interested|company)|what excites you/i, `[PERSONALISE] I'm interested in ${job.company_name} because the ${job.title} role centres on the kind of product engineering I already do daily (${(job.__strong ?? []).slice(0, 3).join(', ')}), and I want to do it at a company whose product I would use and care about. (Add one specific thing about their product.)`],
    [/accommodat|adjustments/i, 'None needed, thank you.'],
    [/resume|cv/i, 'Upload the tailored CV PDF from this workspace.'],
    [/cover letter/i, 'Upload/paste the tailored cover letter from this workspace.'],
    [/pronoun/i, '[OPTIONAL — ADD IF YOU WISH]'],
    [/gender|race|ethnic|veteran|disability|hispanic/i, '[OPTIONAL VOLUNTARY DISCLOSURE — YOUR CHOICE]'],
  ];
  const fromForm: { question: string; required: boolean; answer: string }[] = (research?.screening_questions ?? []).map((qq: any) => ({
    question: qq.label, required: qq.required, answer: known.find(([re]) => re.test(qq.label))?.[1] ?? '[NEEDS YOUR INPUT]',
  }));
  const common = [
    { question: 'Tell us about yourself (short intro)', required: false, answer: intro },
    { question: 'Salary expectation', required: false, answer: salaryAns },
    { question: 'Notice period / availability', required: false, answer: notice },
    { question: 'Where are you located / time zone?', required: false, answer: 'Nigeria (UTC+1), working fully remotely.' },
    { question: 'Links', required: false, answer: `Portfolio: ${L.portfolio}\nGitHub: ${L.github}\nLinkedIn: ${L.linkedin}` },
  ].filter((c) => !fromForm.some((f) => f.question.toLowerCase().includes(c.question.split(' ')[0].toLowerCase())));
  return { formQuestions: fromForm, common, intro, sourcedFromForm: fromForm.length > 0 };
}

export async function saveDoc(userId: number, jobId: number | null, kind: string, title: string, content: unknown, engine: string, warnings: string[]) {
  const prev = await one<{ v: number }>('SELECT COALESCE(MAX(version),0) v FROM documents WHERE user_id=$1 AND job_id IS NOT DISTINCT FROM $2 AND kind=$3', [userId, jobId, kind]);
  return (await one('INSERT INTO documents (user_id, job_id, kind, version, title, content, engine, warnings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [userId, jobId, kind, (prev?.v ?? 0) + 1, title, json(content), engine, json(warnings)]))!;
}

/** Optional AI polish with guardrails: reject output that introduces technologies not in the profile. */
async function aiPolish(userId: number, p: FullProfile, kind: string, draft: string, jobText: string): Promise<{ text: string; engine: string; warnings: string[] }> {
  if (!aiStatus().enabled) return { text: draft, engine: 'rules-v1', warnings: [] };
  const sys = `You edit job-application text for a software engineer. Rewrite the DRAFT ${kind} to read naturally and specifically for the job, concise, no exaggeration.
${STYLE_GUIDE}
STRICT RULES: Do not add any skill, technology, employer, metric, number, achievement or date that is not in the DRAFT. Do not remove [PLACEHOLDER] markers. Return only the rewritten text.`;
  const out = await complete(userId, 'documents', sys, `JOB DESCRIPTION (for context only):\n${jobText.slice(0, 5000)}\n\nDRAFT:\n${draft}`);
  if (!out) return { text: draft, engine: 'rules-v1', warnings: ['AI polish unavailable; deterministic draft used.'] };
  const bad = unsupportedSkills(out, p).filter((k) => !unsupportedSkills(draft, p).includes(k));
  const newNumbers = (out.match(/\b\d+(\.\d+)?%?\b/g) ?? []).filter((n) => !draft.includes(n));
  if (bad.length || newNumbers.length > 2) return { text: draft, engine: 'rules-v1', warnings: [`AI output rejected: introduced ${bad.map(labelOf).join(', ') || 'new numbers'} not in your profile. Deterministic draft used.`] };
  return { text: out, engine: `ai:${aiStatus().provider}`, warnings: [] };
}

export async function generateAll(userId: number, jobId: number) {
  const job = await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [jobId, userId]);
  if (!job) throw new Error('Job not found');
  const analysis = await one('SELECT * FROM job_analyses WHERE job_id=$1', [jobId]);
  if (!analysis) throw new Error('Analyse the job first');
  const research = await one('SELECT * FROM job_research WHERE job_id=$1', [jobId]);
  const p = await loadProfile(userId);
  const reqs: RequirementMatch[] = analysis.requirements;
  job.__strong = reqs.filter((r) => r.match === 'strong').map((r) => r.label);

  // CV
  const cv = buildCv(p, job, reqs);
  const polished = await aiPolish(userId, p, 'CV professional summary', cv.summary, job.description_text ?? '');
  cv.summary = polished.text;
  const cvWarn = [...polished.warnings];
  const leak = unsupportedSkills(cvText(cv), p);
  if (leak.length) cvWarn.push(`Check: mentions ${leak.map(labelOf).join(', ')} which is not in your skills list.`);
  if (cv.meta.omittedSkills.length) cvWarn.push(`Not claimed (not in your profile): ${cv.meta.omittedSkills.join(', ')}.`);
  for (const e of p.experiences.filter((e: any) => e.needs_verification)) cvWarn.push(`Verify before sending: ${e.company} — ${e.verification_note}`);
  const cvDoc = await saveDoc(userId, jobId, 'cv', `CV — ${job.title} @ ${job.company_name}`, cv, polished.engine, cvWarn);

  // Cover letter
  const cl = buildCoverLetter(p, job, analysis, research);
  const clPol = await aiPolish(userId, p, 'cover letter', cl.paragraphs.join('\n\n'), job.description_text ?? '');
  const clContent = { recipient: `Hiring Team, ${job.company_name}`, subject: `${job.title}`, paragraphs: clPol.text.split(/\n{2,}/), signoff: cl.signoff };
  const clDoc = await saveDoc(userId, jobId, 'cover_letter', `Cover letter — ${job.title} @ ${job.company_name}`, clContent, clPol.engine, clPol.warnings);

  // Email (only addressed when an explicit application email exists)
  const to = research?.apply_email ?? null;
  const email = {
    to, toVerified: !!to,
    subject: `Application: ${job.title} — ${p.profile.full_name}`,
    body: `${applicationEmailOpening(job)}\n\n${cl.paragraphs[1] ?? ''}\n\nPortfolio: ${p.profile.links?.portfolio}\nGitHub: ${p.profile.links?.github}\nLinkedIn: ${p.profile.links?.linkedin}\n\nKind regards,\n${p.profile.full_name}\n${p.profile.phone}`,
    note: to ? 'Address taken from the job listing.' : 'No application email was published for this role — apply via the official link. This email is for reference/follow-up only.',
  };
  const emDoc = await saveDoc(userId, jobId, 'email', `Email — ${job.title}`, email, 'rules-v1', to ? [] : ['No verified application email.']);

  const answers = await buildAnswers(p, job, research, userId);
  const ansDoc = await saveDoc(userId, jobId, 'answers', `Screening answers — ${job.title}`, answers, 'rules-v1',
    [...answers.formQuestions, ...answers.common].some((a) => /\[(NEEDS|ADD|CONFIRM|REVIEW|PERSONALISE)/.test(a.answer)) ? ['Some answers need your input — look for [BRACKETED] markers.'] : []);

  await q(`UPDATE applications SET status = CASE WHEN status IN ('discovered','recommended','analysing') THEN 'ready_to_apply' ELSE status END,
            cv_document_id=$2, cover_document_id=$3, destination=COALESCE($4, destination), updated_at=now(),
            history = history || $5::jsonb WHERE job_id=$1`,
    [jobId, cvDoc.id, clDoc.id, research?.official_url ?? job.apply_url, json([{ status: 'ready_to_apply', at: new Date().toISOString(), note: 'Application materials generated' }])]);
  // QA gate on every document (same checks as the agent pipeline).
  const { qaDocument } = await import('./qa.js');
  const qaOf = (kind: 'cv' | 'cover_letter' | 'email' | 'answers', content: unknown, attachments?: { kind: string; ok: boolean }[]) => qaDocument(kind, content, { p, job, attachments });
  const qcv = qaOf('cv', cv); const qcl = qaOf('cover_letter', clContent);
  const refs = json((p.evidence?.refs ?? []).map((r) => r.claimId));
  for (const [d, r] of [[cvDoc, qcv], [clDoc, qcl], [emDoc, qaOf('email', email, [{ kind: 'CV', ok: qcv.passed }, { kind: 'Cover letter', ok: qcl.passed }])], [ansDoc, qaOf('answers', answers)]] as const)
    await q(`UPDATE documents SET qa=$2, evidence_refs=$3 WHERE id=$1`, [d.id, json(r), refs]);
  return { cv: cvDoc, coverLetter: clDoc, email: emDoc, answers: ansDoc };
}

export async function generateMasterCv(userId: number) {
  const p = await loadProfile(userId);
  const cv = buildCv(p, null, []);
  return saveDoc(userId, null, 'cv', 'Master CV', cv, 'rules-v1', p.experiences.filter((e: any) => e.needs_verification).map((e: any) => `Verify: ${e.company} — ${e.verification_note}`));
}
export { skillDef };

/** Natural, varied opening for an application email (deterministic per job). */
export function applicationEmailOpening(job: { id?: number; title: string; company_name: string }) {
  return pickClean(job.id ?? 0, [
    `Hello,\n\nI'm applying for the ${job.title} role at ${job.company_name}. My CV and cover letter are attached.`,
    `Hi ${job.company_name} team,\n\nPlease find my application for the ${job.title} position attached: my CV and a short cover letter.`,
    `Hello,\n\nI saw the ${job.title} opening at ${job.company_name} and would like to apply. I've attached my CV and cover letter.`,
  ]);
}

const pickClean = (seed: number, options: string[]) => pick(seed, options).replace(/\.\.(?=\s|$)/g, '.');
