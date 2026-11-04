import { fetchJson, fetchText } from '../lib/http.js';
import { htmlToText } from '../lib/text.js';
import { ashbyBoard, greenhouseBoard, leverBoard } from '../sources/ats.js';
import type { RawJob } from '../sources/types.js';

const NO_FETCH = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|wellfound\.com|angel\.co|workatastartup\.com)$/i;

/**
 * Import a single job from a URL the user provides.
 *  - Official ATS URLs → fetched via the ATS public API (exact data).
 *  - LinkedIn/Indeed/Glassdoor/Wellfound/YC → NOT fetched (platform terms); the user pastes the text.
 *  - Other company career pages → public page fetched once; schema.org JobPosting JSON-LD parsed.
 */
export async function importFromUrl(input: { url: string; title?: string; company?: string; description?: string; location?: string }): Promise<RawJob> {
  const u = new URL(input.url);
  const host = u.hostname.replace(/^www\./, '');

  let m = /greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?#]+)\/jobs\/(\d+)/.exec(input.url) ?? /[?&]for=([^&]+).*[?&]token=(\d+)/.exec(input.url);
  if (m) {
    const jobs = await greenhouseBoard({ ats: 'greenhouse', slug: m[1], company: input.company || m[1] });
    const j = jobs.find((x) => x.sourceJobId.endsWith(':' + m![2]));
    if (j) return { ...j, company: input.company || (await ghName(m[1])) || j.company };
  }
  m = /jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/.exec(input.url);
  if (m) { const j = (await leverBoard({ ats: 'lever', slug: m[1], company: input.company || m[1] })).find((x) => x.sourceJobId.endsWith(m![2])); if (j) return j; }
  m = /jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/.exec(input.url);
  if (m) { const j = (await ashbyBoard({ ats: 'ashby', slug: m[1], company: input.company || m[1] })).find((x) => x.sourceJobId.endsWith(m![2])); if (j) return j; }

  if (NO_FETCH.test(host)) {
    if (!input.description || !input.title || !input.company) throw new Error(`${host} does not permit automated access. Paste the job title, company and full description, and CareerPilot will analyse it and search for the employer's official posting.`);
    return manual(input, `import:${host}`);
  }
  if (input.description && input.title && input.company) return manual(input, `import:${host}`);

  const { text: html } = await fetchText(input.url, { accept: 'text/html' });
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1]);
  for (const b of blocks) {
    try {
      const data = JSON.parse(b.trim());
      const items = (Array.isArray(data) ? data : data['@graph'] ?? [data]) as any[];
      const jp = items.find((i) => i['@type'] === 'JobPosting');
      if (!jp) continue;
      const loc = [jp.jobLocationType, ...[jp.jobLocation].flat().filter(Boolean).map((l: any) => [l.address?.addressLocality, l.address?.addressCountry?.name ?? l.address?.addressCountry].filter(Boolean).join(', ')), ...[jp.applicantLocationRequirements].flat().filter(Boolean).map((a: any) => a.name)].filter(Boolean).join(' | ');
      const bs = jp.baseSalary?.value;
      return {
        source: `import:${host}`, sourceJobId: input.url, sourceUrl: input.url, title: jp.title, company: input.company || jp.hiringOrganization?.name || host,
        companyWebsite: jp.hiringOrganization?.sameAs ?? null, postedAt: jp.datePosted ? new Date(jp.datePosted) : null, deadline: jp.validThrough ? new Date(jp.validThrough) : null,
        descriptionHtml: jp.description, descriptionText: htmlToText(jp.description), locationRaw: loc || input.location || null, employmentType: [jp.employmentType].flat().join(', ') || null,
        salaryMin: bs?.minValue ?? bs?.value ?? null, salaryMax: bs?.maxValue ?? null, salaryCurrency: jp.baseSalary?.currency ?? null,
        salaryPeriod: bs?.unitText ? (/MONTH/i.test(bs.unitText) ? 'month' : /HOUR/i.test(bs.unitText) ? 'hour' : 'year') : null,
        applyUrl: input.url, raw: { jsonld: true },
      };
    } catch { /* try next block */ }
  }
  throw new Error('No structured job data found on that page. Paste the title, company and description to import it manually.');
}

async function ghName(slug: string) { try { return (await fetchJson<{ name: string }>(`https://boards-api.greenhouse.io/v1/boards/${slug}`)).name; } catch { return null; } }

function manual(i: { url: string; title?: string; company?: string; description?: string; location?: string }, source: string): RawJob {
  return { source, sourceJobId: i.url, sourceUrl: i.url, title: i.title!, company: i.company!, descriptionText: i.description!, descriptionHtml: null, locationRaw: i.location ?? null, applyUrl: i.url, postedAt: null, raw: { manual: true } };
}
