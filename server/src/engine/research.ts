import { json, one, q } from '../db.js';
import { checkUrl, fetchJson } from '../lib/http.js';
import { extractEmails, htmlToText, normKey, normTitle, splitSections } from '../lib/text.js';
import { BOARD_FETCHERS } from '../sources/ats.js';
import { sourceById } from '../sources/index.js';
import type { Board, RawJob } from '../sources/types.js';
import { detectAts } from './store.js';

/**
 * Company & Application Research Agent.
 * Every check is logged with its URL and outcome, so the user can audit what was verified.
 * Nothing is marked verified unless a request to the official source confirmed it.
 */
export interface ResearchLog { step: string; url?: string; result: string; ok: boolean }

const ATS_BOARD_URL: Record<string, (slug: string) => string> = {
  greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`,
  lever: (s) => `https://jobs.lever.co/${s}`,
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
  workable: (s) => `https://apply.workable.com/${s}`,
};

function slugCandidates(company: string): string[] {
  const base = company.toLowerCase().replace(/\(.*?\)/g, '').replace(/[,.]?\s+(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|technologies|labs|hq)\.?$/i, '').trim();
  const c = new Set([normKey(company), base.replace(/[^a-z0-9]+/g, ''), base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), base.split(/\s+/)[0].replace(/[^a-z0-9]/g, '')]);
  return [...c].filter((s) => s && s.length >= 2).slice(0, 4);
}

function wordSet(s: string) { return new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3)); }
export function similarity(a: string, b: string) {
  const A = wordSet(a); const B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
function titleMatch(a: string, b: string) {
  const x = normTitle(a); const y = normTitle(b);
  if (x === y) return 1;
  const A = new Set(x.split(' ')); const B = new Set(y.split(' '));
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

const DOC_PATTERNS: [RegExp, string][] = [
  [/cover letter|motivation letter|letter of motivation/i, 'Cover letter'],
  [/portfolio/i, 'Portfolio link'],
  [/github|code samples?|open[- ]source contributions/i, 'GitHub profile / code samples'],
  [/linkedin/i, 'LinkedIn profile'],
  [/references?\b/i, 'References'],
  [/salary expectation|expected salary|compensation expectation/i, 'Salary expectation'],
  [/notice period|start date|availability/i, 'Availability / notice period'],
  [/take[- ]home|assignment|coding (test|challenge|exercise)/i, 'Prepare for a take-home/coding exercise'],
  [/loom|video (introduction|intro)/i, 'Short video introduction'],
];

/** Find a company's official website via public domain lookup; verified only if the site responds. */
export async function lookupCompanyWebsite(companyName: string, log: ResearchLog[]): Promise<string | null> {
  try {
    const sug = await fetchJson<{ name: string; domain: string }[]>(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`, { retries: 1 });
    const best = sug.find((s) => normKey(s.name) === normKey(companyName));
    if (!best) { log.push({ step: 'Company website', result: `No exact domain match for “${companyName}”`, ok: false }); return null; }
    const site = `https://${best.domain}`;
    const chk = await checkUrl(site);
    log.push({ step: 'Company website', url: site, result: chk.ok ? `Found via domain lookup (HTTP ${chk.status})` : `Lookup suggested ${best.domain} but it did not respond`, ok: chk.ok });
    return chk.ok ? site : null;
  } catch (e) { log.push({ step: 'Company website', result: `Lookup failed: ${(e as Error).message}`, ok: false }); return null; }
}

export type ResearchRow = Awaited<ReturnType<typeof investigateApplication>>['row'];

/** Backwards-compatible: company lookup + investigation + persistence in one call. */
export async function researchJob(userId: number, jobId: number) {
  const job = await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [jobId, userId]);
  if (!job) throw new Error('Job not found');
  const company = await one('SELECT * FROM companies WHERE id=$1', [job.company_id]);
  const pre: ResearchLog[] = [];
  const website = company?.website ?? (await lookupCompanyWebsite(job.company_name, pre));
  const r = await investigateApplication(userId, jobId, { website });
  r.row.log.splice(1, 0, ...pre);
  await saveResearch(jobId, r);
  return r.row;
}

/** Application Research: computes everything, writes nothing (persistence is the caller's job). */
export async function investigateApplication(userId: number, jobId: number, opts: { website?: string | null }) {
  const job = await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [jobId, userId]);
  if (!job) throw new Error('Job not found');
  const log: ResearchLog[] = [];
  const raw = job.raw ?? {};
  const text: string = job.description_text ?? '';
  const discoveredOn = sourceById(job.source)?.name ?? job.source;
  log.push({ step: 'Original listing', url: job.source_url, result: `Discovered on ${discoveredOn}`, ok: true });

  let ats: string | null = ['greenhouse', 'lever', 'ashby', 'workable'].includes(job.source) ? job.source : null;
  let atsSlug: string | null = ats ? raw.board : null;
  let officialUrl: string | null = ats ? job.source_url : null;
  let officialApply: string | null = ats ? job.apply_url : null;
  let officialVerified = false;
  let descMatches: boolean | null = null;
  let stillOpen: boolean | null = null;
  let questions: { label: string; required: boolean }[] = [];
  let officialText: string | null = null;

  // 1) Is the listing itself live?
  const live = await checkUrl(job.source_url);
  log.push({ step: 'Listing reachable', url: job.source_url, result: `HTTP ${live.status}`, ok: live.ok });

  // 2) Company website comes from the Company Research Agent (may be null).
  const website: string | null = opts.website ?? null;

  // 3) Find the official posting on the employer's ATS (if discovered on an aggregator).
  //    First: an ATS link in the listing's apply URL or embedded in the public listing page.
  let candidateApply: string | null = detectAts(job.apply_url) ? job.apply_url : null;
  if (!candidateApply && live.ok && !ats) {
    const links = [...live.body.matchAll(/href="(https?:\/\/[^"#]+)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
    candidateApply = links.find((l) => detectAts(l) && !/\/(embed|widget)\b/.test(l)) ?? null;
    if (candidateApply) log.push({ step: 'Employer link found on listing page', url: candidateApply, result: `Points to ${detectAts(candidateApply)}`, ok: true });
  }
  const extAts = detectAts(candidateApply);
  if (!ats && extAts && candidateApply) {
    const chk = await checkUrl(candidateApply);
    log.push({ step: `Apply link points to ${extAts}`, url: candidateApply, result: `HTTP ${chk.status}`, ok: chk.ok });
    if (chk.ok) { ats = extAts; officialUrl = candidateApply; officialApply = candidateApply; officialVerified = true; stillOpen = true; await q(`UPDATE jobs SET last_verified_open_at=now() WHERE id=$1`, [jobId]); }
  }
  if (!officialVerified && !['greenhouse', 'lever', 'ashby', 'workable'].includes(job.source)) {
    const cands = slugCandidates(job.company_name);
    outer: for (const a of ['greenhouse', 'ashby', 'lever', 'workable'] as const) {
      for (const slug of cands) {
        let jobs: RawJob[] = [];
        try { jobs = await BOARD_FETCHERS[a]({ ats: a, slug, company: job.company_name } as Board); }
        catch { continue; }
        if (!jobs.length) { log.push({ step: `Checked ${a} board “${slug}”`, url: ATS_BOARD_URL[a](slug), result: 'Board exists but has no open roles', ok: false }); continue; }
        // Board names can collide (e.g. slug "remote" ≠ Remote.com) — require company-name agreement when the ATS exposes it.
        const best = jobs.map((j) => ({ j, s: titleMatch(j.title, job.title) })).sort((x, y) => y.s - x.s)[0];
        log.push({ step: `Checked ${a} board “${slug}”`, url: ATS_BOARD_URL[a](slug), result: `${jobs.length} open roles; best title match “${best.j.title}” (${Math.round(best.s * 100)}%)`, ok: best.s >= 0.8 });
        if (best.s >= 0.8) {
          const sim = similarity(best.j.descriptionText ?? '', text);
          if (sim < 0.35 && text.length > 400) { log.push({ step: 'Description comparison', result: `Only ${Math.round(sim * 100)}% overlap — probably a different company using the same slug; rejected.`, ok: false }); continue; }
          ats = a; atsSlug = slug; officialUrl = best.j.sourceUrl; officialApply = best.j.applyUrl ?? best.j.sourceUrl; officialVerified = true; stillOpen = true;
          officialText = best.j.descriptionText ?? null;
          if (best.j.postedAt) await q(`UPDATE jobs SET original_published_at=$2, last_verified_open_at=now() WHERE id=$1`, [jobId, best.j.postedAt]);
          descMatches = text.length < 400 ? null : sim >= 0.6;
          log.push({ step: 'Official posting found', url: officialUrl!, result: `Description overlap with original listing: ${Math.round(sim * 100)}%`, ok: true });
          if (a === 'greenhouse') raw.__gh = { board: slug, id: String((best.j.raw as any)?.id) };
          break outer;
        }
      }
    }
  }
  // 3b) Official ATS source: confirm via API.
  if (['greenhouse', 'lever', 'ashby', 'workable'].includes(job.source)) {
    officialVerified = live.ok; stillOpen = live.ok && job.status !== 'expired';
    log.push({ step: 'Official ATS posting', url: job.source_url, result: live.ok ? 'Live on employer ATS' : 'Not reachable', ok: live.ok });
  }

  // 4) Greenhouse exposes the real application form questions.
  const gh = job.source === 'greenhouse' ? { board: raw.board, id: String(raw.id) } : raw.__gh;
  if (gh) {
    try {
      const d = await fetchJson<any>(`https://boards-api.greenhouse.io/v1/boards/${gh.board}/jobs/${gh.id}?questions=true`);
      questions = (d.questions ?? []).map((x: any) => ({ label: x.label, required: !!x.required }));
      log.push({ step: 'Application form questions', url: `https://boards-api.greenhouse.io/v1/boards/${gh.board}/jobs/${gh.id}?questions=true`, result: `${questions.length} questions retrieved`, ok: true });
      if (d.application_deadline) job.deadline = d.application_deadline;
    } catch (e) { log.push({ step: 'Application form questions', result: (e as Error).message, ok: false }); }
  }

  // 5) Careers page on the company website.
  let careers: string | null = atsSlug && ats ? ATS_BOARD_URL[ats]?.(atsSlug) ?? null : null;
  if (!careers && website) {
    for (const p of ['/careers', '/jobs', '/careers/']) {
      const u = website.replace(/\/$/, '') + p;
      const r = await checkUrl(u);
      if (r.ok) { careers = r.finalUrl || u; log.push({ step: 'Careers page', url: careers, result: `HTTP ${r.status}`, ok: true }); break; }
    }
    if (!careers) log.push({ step: 'Careers page', result: 'No /careers or /jobs page found on company website', ok: false });
  }

  // 6) Application channel. Emails are used ONLY when the listing explicitly says to apply by email.
  const emails = extractEmails(text);
  const applyEmail = emails.find((e) => new RegExp(`(apply|send|email|submit|cv|resume)[^.\\n]{0,80}${e.replace(/[.+]/g, '\\$&')}|${e.replace(/[.+]/g, '\\$&')}[^.\\n]{0,40}(with your|including)`, 'i').test(text)) ?? null;
  let applyMethod = 'unknown';
  if (officialVerified && ats) applyMethod = 'ats_form';
  else if (applyEmail) applyMethod = 'email';
  else if (job.apply_url) applyMethod = 'external_link';
  if (applyEmail) log.push({ step: 'Application email', result: `Listing explicitly asks applicants to email ${applyEmail}`, ok: true });

  // 7) Required documents & deadline.
  const docs = new Set<string>(['CV / résumé']);
  for (const [re, label] of DOC_PATTERNS) if (re.test(text)) docs.add(label);
  for (const qn of questions) {
    if (/cover letter/i.test(qn.label)) docs.add(qn.required ? 'Cover letter (required)' : 'Cover letter (optional)');
    if (/linkedin/i.test(qn.label)) docs.add('LinkedIn profile');
    if (/github|portfolio|website/i.test(qn.label)) docs.add('Portfolio / GitHub link');
  }
  const deadlineMatch = /(apply by|deadline|closing date|applications close)[^.\n]{0,60}/i.exec(text);
  const deadlineText = job.deadline ? new Date(job.deadline).toDateString() : deadlineMatch ? deadlineMatch[0] : 'Not disclosed';

  // 8) Company facts — only quoted from official text, with source.
  const facts: { fact: string; source_url: string; verified: boolean }[] = [];
  const about = splitSections(officialText ?? text).find((s) => s.kind === 'about');
  if (about) facts.push({ fact: about.text.trim().slice(0, 600), source_url: officialUrl ?? job.source_url, verified: !!officialUrl });
  if (ats === 'greenhouse' && atsSlug) {
    try { const b = await fetchJson<any>(`https://boards-api.greenhouse.io/v1/boards/${atsSlug}`); if (b.content) facts.push({ fact: htmlToText(b.content).slice(0, 600), source_url: ATS_BOARD_URL.greenhouse(atsSlug), verified: true }); } catch { /* optional */ }
  }

  // 9) Exact steps.
  const steps: string[] = [];
  if (applyMethod === 'ats_form') {
    steps.push(`Open the official application: ${officialApply ?? officialUrl}`);
    steps.push(`Upload your tailored CV (download it from this workspace).`);
    if ([...docs].some((d) => /Cover letter/.test(d))) steps.push('Paste or upload the tailored cover letter.');
    if (questions.length) steps.push(`Answer ${questions.length} form questions (${questions.filter((x) => x.required).length} required) — drafts are in "Screening answers".`);
    steps.push('Add portfolio, GitHub and LinkedIn links where the form asks.');
    steps.push('Review everything, submit yourself, then click "Mark as applied".');
  } else if (applyMethod === 'email') {
    steps.push(`Email ${applyEmail} using the prepared application email.`, 'Attach the tailored CV (PDF) and cover letter.', 'Send it yourself, then click "Mark as applied".');
  } else {
    steps.push(`Open the listing: ${job.apply_url ?? job.source_url}`, 'Follow the “Apply” button to the employer’s page (destination not yet verified).', 'Confirm the employer accepts Nigeria-based applicants before submitting.', 'Then click "Mark as applied".');
  }

  const row = {
    discovered_on: discoveredOn, employer: job.company_name, company_website: website, careers_page: careers,
    official_url: officialApply ?? officialUrl, official_url_verified: officialVerified, ats, apply_method: applyMethod, apply_email: applyEmail,
    still_open: stillOpen ?? (live.ok ? null : false), description_matches_official: descMatches, required_documents: [...docs], screening_questions: questions, deadline_text: deadlineText, steps, log,
  };
  return { row, company: { id: job.company_id as number, website, careers, ats, atsSlug, facts }, liveOk: live.ok, liveStatus: live.status };
}

/** Deterministic persistence of an Application Research result. */
export async function saveResearch(jobId: number, r: Awaited<ReturnType<typeof investigateApplication>>) {
  const { row, company: c } = r;
  await q(`UPDATE companies SET website=COALESCE($2, website), careers_url=COALESCE($3, careers_url), ats=COALESCE($4, ats), ats_slug=COALESCE($5, ats_slug), facts=CASE WHEN jsonb_array_length($6::jsonb) > 0 THEN $6::jsonb ELSE facts END, researched_at=now() WHERE id=$1`,
    [c.id, c.website, c.careers, c.ats, c.atsSlug, json(c.facts)]);
  await q(
    `INSERT INTO job_research (job_id, discovered_on, employer, company_website, careers_page, official_url, official_url_verified, ats, apply_method, apply_email, still_open, description_matches_official, required_documents, screening_questions, deadline_text, steps, log, researched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
     ON CONFLICT (job_id) DO UPDATE SET discovered_on=$2, employer=$3, company_website=$4, careers_page=$5, official_url=$6, official_url_verified=$7, ats=$8, apply_method=$9, apply_email=$10, still_open=$11, description_matches_official=$12, required_documents=$13, screening_questions=$14, deadline_text=$15, steps=$16, log=$17, researched_at=now()`,
    [jobId, row.discovered_on, row.employer, row.company_website, row.careers_page, row.official_url, row.official_url_verified, row.ats, row.apply_method, row.apply_email, row.still_open, row.description_matches_official, json(row.required_documents), json(row.screening_questions), row.deadline_text, json(row.steps), json(row.log)],
  );
  if (r.liveOk || row.official_url_verified) await q(`UPDATE jobs SET last_checked_at=now(), last_check_result=$2 WHERE id=$1`, [jobId, row.official_url_verified ? 'Verified live on official ATS during research' : `Listing reachable (HTTP ${r.liveStatus})`]);
  return row;
}
