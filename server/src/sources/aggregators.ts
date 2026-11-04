import { XMLParser } from 'fast-xml-parser';
import { fetchJson, fetchText } from '../lib/http.js';
import { htmlToText } from '../lib/text.js';
import type { JobSource, RawJob } from './types.js';

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number(v) === 0 || isNaN(Number(v)) ? null : Number(v));

/** Remote OK public API. Terms: link back & attribute Remote OK as source (we store and show source URL). */
export const remoteok: JobSource = {
  id: 'remoteok', name: 'Remote OK', kind: 'aggregator', available: true,
  access: 'Official public JSON API (https://remoteok.com/api), attribution to Remote OK shown on every job.',
  async fetch(ctx) {
    const tags = ['dev', 'react', 'vue', 'javascript', 'typescript', 'node', 'full-stack', 'backend', 'frontend', 'python'];
    const seen = new Map<string, RawJob>();
    for (const tag of tags) {
      try {
        const data = await fetchJson<any[]>(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`);
        for (const j of data.slice(1)) {
          if (!j?.id || seen.has(String(j.id))) continue;
          seen.set(String(j.id), {
            source: 'remoteok', sourceJobId: String(j.id), sourceUrl: j.url, title: j.position, company: j.company,
            postedAt: toDate(j.epoch ?? j.date), descriptionHtml: j.description, descriptionText: htmlToText(j.description),
            locationRaw: j.location || null, tags: j.tags ?? [],
            salaryMin: num(j.salary_min), salaryMax: num(j.salary_max), salaryCurrency: num(j.salary_min) ? 'USD' : null, salaryPeriod: num(j.salary_min) ? 'year' : null,
            applyUrl: j.apply_url || j.url, raw: { id: j.id, tags: j.tags, location: j.location },
          });
        }
      } catch (e) { ctx.log(`tag ${tag}: ${(e as Error).message}`); }
    }
    return [...seen.values()];
  },
};

/** Remotive public API (software-dev category, keyword search). */
export const remotive: JobSource = {
  id: 'remotive', name: 'Remotive', kind: 'aggregator', available: true,
  access: 'Official public JSON API (https://remotive.com/api/remote-jobs). Attribution required; jobs link back to Remotive.',
  async fetch(ctx) {
    const data = await fetchJson<{ jobs: any[] }>('https://remotive.com/api/remote-jobs?category=software-dev');
    return data.jobs.map((j) => ({
      source: 'remotive', sourceJobId: String(j.id), sourceUrl: j.url, title: j.title, company: j.company_name,
      postedAt: toDate(j.publication_date), descriptionHtml: j.description, descriptionText: htmlToText(j.description),
      locationRaw: j.candidate_required_location || null, employmentType: j.job_type || null, salaryRaw: j.salary || null,
      tags: j.tags ?? [], applyUrl: j.url, raw: { id: j.id, location: j.candidate_required_location, salary: j.salary },
    }));
    void ctx;
  },
};

/** Himalayas public API — has structured location & timezone restrictions (excellent for eligibility). */
export const himalayas: JobSource = {
  id: 'himalayas', name: 'Himalayas', kind: 'aggregator', available: true,
  access: 'Official public JSON API (https://himalayas.app/jobs/api/search).',
  async fetch(ctx) {
    const out = new Map<string, RawJob>();
    const queries = ctx.keywords.slice(0, 10);
    for (const q of queries) {
      for (let page = 1; page <= 2; page++) {
        try {
          const d = await fetchJson<{ jobs: any[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&page=${page}`);
          for (const j of d.jobs ?? []) {
            const id = j.guid || j.applicationLink;
            if (out.has(id)) continue;
            out.set(id, {
              source: 'himalayas', sourceJobId: id, sourceUrl: j.guid || j.applicationLink, title: j.title, company: j.companyName,
              postedAt: toDate(j.pubDate), deadline: toDate(j.expiryDate),
              descriptionHtml: j.description, descriptionText: htmlToText(j.description),
              locationRestrictions: j.locationRestrictions ?? [], timezoneRestrictions: j.timezoneRestrictions ?? [],
              locationRaw: (j.locationRestrictions ?? []).length ? j.locationRestrictions.join(', ') : 'Worldwide (no restrictions listed)',
              employmentType: j.employmentType, seniority: (j.seniority ?? []).join(', ') || null,
              salaryMin: num(j.minSalary), salaryMax: num(j.maxSalary), salaryCurrency: j.currency || null,
              salaryPeriod: j.salaryPeriod === 'annual' ? 'year' : j.salaryPeriod === 'monthly' ? 'month' : j.salaryPeriod === 'hourly' ? 'hour' : null,
              tags: j.categories ?? [], applyUrl: j.applicationLink,
              raw: { companySlug: j.companySlug, locationRestrictions: j.locationRestrictions, timezoneRestrictions: j.timezoneRestrictions, seniority: j.seniority },
            });
          }
          if ((d.jobs ?? []).length < 20) break;
        } catch (e) { ctx.log(`q="${q}" p${page}: ${(e as Error).message}`); break; }
      }
    }
    return [...out.values()];
  },
};

/** We Work Remotely — official public RSS feeds per category. */
export const weworkremotely: JobSource = {
  id: 'weworkremotely', name: 'We Work Remotely', kind: 'aggregator', available: true,
  access: 'Official public RSS feeds (weworkremotely.com/categories/*.rss).',
  async fetch(ctx) {
    const feeds = ['remote-full-stack-programming-jobs', 'remote-back-end-programming-jobs', 'remote-front-end-programming-jobs'];
    const parser = new XMLParser({ ignoreAttributes: false });
    const out: RawJob[] = [];
    for (const f of feeds) {
      try {
        const { text } = await fetchText(`https://weworkremotely.com/categories/${f}.rss`, { accept: 'application/rss+xml' });
        const items = parser.parse(text)?.rss?.channel?.item ?? [];
        for (const it of Array.isArray(items) ? items : [items]) {
          const full = String(it.title ?? '');
          const idx = full.indexOf(':');
          const company = idx > 0 ? full.slice(0, idx).trim() : 'Unknown';
          const title = idx > 0 ? full.slice(idx + 1).trim() : full;
          const html = String(it.description ?? '');
          out.push({
            source: 'weworkremotely', sourceJobId: String(it.guid?.['#text'] ?? it.guid ?? it.link), sourceUrl: it.link, title, company,
            postedAt: toDate(it.pubDate), descriptionHtml: html, descriptionText: htmlToText(html),
            locationRaw: it.region ?? null, employmentType: it.type ?? null, tags: [it.category].filter(Boolean),
            applyUrl: it.link, raw: { region: it.region, category: it.category, type: it.type },
          });
        }
      } catch (e) { ctx.log(`${f}: ${(e as Error).message}`); }
    }
    return out;
  },
};

/** Jobicy public API — tag & geo filters. */
export const jobicy: JobSource = {
  id: 'jobicy', name: 'Jobicy', kind: 'aggregator', available: true,
  access: 'Official public JSON API (https://jobicy.com/api/v2/remote-jobs).',
  async fetch(ctx) {
    const tags = ['react', 'vue', 'javascript', 'typescript', 'node', 'full-stack', 'frontend', 'backend', 'python'];
    const seen = new Map<string, RawJob>();
    for (const tag of tags) {
      try {
        const d = await fetchJson<{ jobs: any[] }>(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`);
        for (const j of d.jobs ?? []) {
          if (seen.has(String(j.id))) continue;
          seen.set(String(j.id), {
            source: 'jobicy', sourceJobId: String(j.id), sourceUrl: j.url, title: j.jobTitle, company: j.companyName,
            postedAt: toDate(j.pubDate), descriptionHtml: j.jobDescription, descriptionText: htmlToText(j.jobDescription),
            locationRaw: j.jobGeo ?? null, employmentType: (j.jobType ?? []).join(', ') || null, seniority: j.jobLevel ?? null,
            salaryMin: num(j.salaryMin ?? j.annualSalaryMin), salaryMax: num(j.salaryMax ?? j.annualSalaryMax), salaryCurrency: j.salaryCurrency ?? null,
            salaryPeriod: j.salaryPeriod === 'monthly' ? 'month' : j.salaryPeriod === 'hourly' ? 'hour' : (j.salaryMin || j.annualSalaryMin) ? 'year' : null,
            tags: j.jobIndustry ?? [], applyUrl: j.url, raw: { geo: j.jobGeo, level: j.jobLevel },
          });
        }
      } catch (e) { ctx.log(`tag ${tag}: ${(e as Error).message}`); }
    }
    return [...seen.values()];
  },
};

/** Sources the user asked for that have no permitted automated access. Kept visible, with honest reasons. */
const unsupported = (id: string, name: string, reason: string): JobSource => ({
  id, name, kind: 'unsupported', available: false, access: 'Manual import only', unavailableReason: reason,
  async fetch() { return []; },
});

export const linkedin = unsupported('linkedin', 'LinkedIn Jobs', 'LinkedIn prohibits automated scraping and its Job Search API is partner-only. Paste a LinkedIn job URL + description via "Import job" — CareerPilot will then find the employer’s official listing.');
export const indeed = unsupported('indeed', 'Indeed', 'Indeed retired its public Job Search API and disallows scraping. Use "Import job" for listings you find there.');
export const wellfound = unsupported('wellfound', 'Wellfound', 'Wellfound has no public jobs API and requires login. Use "Import job"; most Wellfound startups also post on Ashby/Greenhouse/Lever, which CareerPilot searches directly.');
export const ycombinator = unsupported('ycombinator', 'Y Combinator Work at a Startup', 'Requires a logged-in account; no public API. YC companies using Ashby/Greenhouse/Lever can be added to Company boards.');
