import { fetchJson } from '../lib/http.js';
import { htmlToText } from '../lib/text.js';
import type { Board, JobSource, RawJob, SourceContext } from './types.js';

/** Official public job-board APIs exposed by applicant tracking systems for each company. */

export async function greenhouseBoard(b: Board): Promise<RawJob[]> {
  const d = await fetchJson<{ jobs: any[] }>(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`, { timeoutMs: 90000 });
  return (d.jobs ?? []).map((j) => {
    const html = j.content ?? '';
    const pay = (j.pay_input_ranges ?? [])[0];
    return {
      source: 'greenhouse', sourceJobId: `${b.slug}:${j.id}`, sourceUrl: j.absolute_url, title: j.title, company: b.company,
      postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : null,
      deadline: j.application_deadline ? new Date(j.application_deadline) : null,
      descriptionHtml: html, descriptionText: htmlToText(html),
      locationRaw: [j.location?.name, ...(j.offices ?? []).map((o: any) => o.location || o.name)].filter(Boolean).join(' | '),
      employmentType: (j.metadata ?? []).find((m: any) => /employment|type/i.test(m.name))?.value ?? null,
      salaryMin: pay ? pay.min_cents / 100 : null, salaryMax: pay ? pay.max_cents / 100 : null, salaryCurrency: pay?.currency_type ?? null, salaryPeriod: pay ? 'year' : null,
      applyUrl: j.absolute_url, ats: 'greenhouse', raw: { board: b.slug, id: j.id, location: j.location, offices: j.offices },
    } satisfies RawJob;
  });
}

export async function leverBoard(b: Board): Promise<RawJob[]> {
  const d = await fetchJson<any[]>(`https://api.lever.co/v0/postings/${b.slug}?mode=json`);
  return (d ?? []).map((j) => {
    const html = [j.descriptionBody ?? j.description, ...(j.lists ?? []).map((l: any) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), j.additional].filter(Boolean).join('\n');
    const sr = j.salaryRange;
    return {
      source: 'lever', sourceJobId: `${b.slug}:${j.id}`, sourceUrl: j.hostedUrl, title: j.text, company: b.company,
      postedAt: j.createdAt ? new Date(j.createdAt) : null, descriptionHtml: html, descriptionText: htmlToText(html),
      locationRaw: [j.categories?.location, ...(j.categories?.allLocations ?? []), j.workplaceType].filter(Boolean).join(' | '),
      employmentType: j.categories?.commitment ?? null,
      salaryMin: sr?.min ?? null, salaryMax: sr?.max ?? null, salaryCurrency: sr?.currency ?? null,
      salaryPeriod: sr ? (/month/i.test(sr.interval) ? 'month' : /hour/i.test(sr.interval) ? 'hour' : 'year') : null,
      applyUrl: j.applyUrl ?? j.hostedUrl, ats: 'lever', raw: { board: b.slug, id: j.id, categories: j.categories, workplaceType: j.workplaceType, country: j.country },
    } satisfies RawJob;
  });
}

export async function ashbyBoard(b: Board): Promise<RawJob[]> {
  const d = await fetchJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.slug)}?includeCompensation=true`);
  return (d.jobs ?? []).filter((j) => j.isListed !== false).map((j) => {
    const comp = j.compensation?.summaryComponents?.find((c: any) => c.compensationType === 'Salary') ??
      j.compensation?.compensationTiers?.[0]?.components?.find((c: any) => c.compensationType === 'Salary');
    const locs = [j.location, ...(j.secondaryLocations ?? []).map((s: any) => s.location), j.address?.postalAddress?.addressCountry].filter(Boolean);
    return {
      source: 'ashby', sourceJobId: `${b.slug}:${j.id}`, sourceUrl: j.jobUrl, title: j.title.trim(), company: b.company,
      postedAt: j.publishedAt ? new Date(j.publishedAt) : null, descriptionHtml: j.descriptionHtml, descriptionText: j.descriptionPlain || htmlToText(j.descriptionHtml),
      locationRaw: [...new Set(locs)].join(' | ') + (j.isRemote ? ' | Remote' : ''),
      employmentType: j.employmentType ?? null,
      salaryRaw: j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary ?? null,
      salaryMin: comp?.minValue ?? null, salaryMax: comp?.maxValue ?? null, salaryCurrency: comp?.currencyCode ?? null,
      salaryPeriod: comp ? (/month/i.test(comp.interval) ? 'month' : /hour/i.test(comp.interval) ? 'hour' : 'year') : null,
      applyUrl: j.applyUrl ?? j.jobUrl, ats: 'ashby', raw: { board: b.slug, id: j.id, isRemote: j.isRemote, workplaceType: j.workplaceType, address: j.address, secondaryLocations: j.secondaryLocations },
    } satisfies RawJob;
  });
}

export async function workableBoard(b: Board): Promise<RawJob[]> {
  const d = await fetchJson<{ name: string; jobs: any[] }>(`https://apply.workable.com/api/v1/widget/accounts/${b.slug}?details=true`);
  return (d.jobs ?? []).map((j) => {
    const html = j.description ?? '';
    const loc = (j.locations ?? []).map((l: any) => [l.city, l.region, l.country].filter(Boolean).join(', '));
    return {
      source: 'workable', sourceJobId: `${b.slug}:${j.shortcode}`, sourceUrl: j.url ?? j.shortlink, title: j.title, company: d.name || b.company,
      postedAt: j.published_on ? new Date(j.published_on) : j.created_at ? new Date(j.created_at) : null,
      descriptionHtml: html, descriptionText: htmlToText(html),
      locationRaw: [...loc, j.country, j.telecommuting ? 'Remote' : null].filter(Boolean).join(' | '),
      employmentType: j.employment_type ?? null, applyUrl: j.application_url ?? j.url, ats: 'workable',
      raw: { board: b.slug, shortcode: j.shortcode, telecommuting: j.telecommuting, country: j.country },
    } satisfies RawJob;
  });
}

const BOARD_FETCHERS = { greenhouse: greenhouseBoard, lever: leverBoard, ashby: ashbyBoard, workable: workableBoard };

/** One "source" per ATS so failures are isolated and logged per platform. */
function atsSource(ats: Board['ats'], name: string): JobSource {
  return {
    id: ats, name: `${name} company boards`, kind: 'ats', available: true,
    access: `Official public ${name} job-board API, per company you configure in Search Settings.`,
    async fetch(ctx: SourceContext) {
      const out: RawJob[] = [];
      for (const b of ctx.boards.filter((x) => x.ats === ats)) {
        try { out.push(...(await BOARD_FETCHERS[ats](b))); }
        catch (e) { ctx.log(`${b.company} (${b.slug}): ${(e as Error).message}`); }
      }
      return out;
    },
  };
}

export const greenhouse = atsSource('greenhouse', 'Greenhouse');
export const lever = atsSource('lever', 'Lever');
export const ashby = atsSource('ashby', 'Ashby');
export const workable = atsSource('workable', 'Workable');
export { BOARD_FETCHERS };
