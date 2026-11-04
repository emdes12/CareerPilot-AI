import { z } from 'zod';
import { htmlToText, normKey } from '../lib/text.js';
import { defineAgent } from './core/types.js';
import { quoteInText } from './schemas.js';

const Fact = z.object({ fact: z.string(), source_url: z.string(), verified: z.boolean() });
const Log = z.object({ step: z.string(), url: z.string().optional(), result: z.string(), ok: z.boolean() });

export const companyResearchAgent = defineAgent({
  name: 'company-research',
  version: '1.0.0',
  description: 'Identifies the hiring company: official website, careers page and short, source-quoted company facts.',
  modelClass: 'research',
  systemPrompt: `You are the Company Research Agent. Given text fetched from a company's own website, write up to 3 short factual statements about what the company does (product, customers, mission).
Each fact must include "quote": a verbatim excerpt from the provided page text that supports it. Never use outside knowledge, never guess size, funding, or location.`,
  input: z.object({ jobId: z.number(), companyId: z.number().nullable(), company: z.string(), knownWebsite: z.string().nullable(), aboutSection: z.string().nullable(), listingUrl: z.string() }),
  output: z.object({ website: z.string().nullable(), websiteVerified: z.boolean(), careersPage: z.string().nullable(), facts: z.array(Fact), log: z.array(Log) }),
  tools: ['company.lookupDomain', 'http.checkUrl', 'http.fetchPublic'],
  dependsOn: [],
  retry: { attempts: 2, backoffMs: 2000 },
  timeoutMs: 120000,
  async run(ctx, input) {
    const log: z.infer<typeof Log>[] = [];
    let website = input.knownWebsite; let websiteVerified = false;
    if (!website) {
      try {
        const sug = await ctx.tools['company.lookupDomain'](input.company);
        const best = sug.find((s) => normKey(s.name) === normKey(input.company));
        if (best) website = `https://${best.domain}`;
        log.push({ step: 'Domain lookup', result: best ? `Exact name match → ${best.domain}` : `No exact match for “${input.company}”`, ok: !!best });
      } catch (e) { log.push({ step: 'Domain lookup', result: (e as Error).message, ok: false }); }
    }
    let homeText = '';
    if (website) {
      const chk = await ctx.tools['http.checkUrl'](website);
      websiteVerified = chk.ok;
      log.push({ step: 'Website reachable', url: website, result: `HTTP ${chk.status}`, ok: chk.ok });
      if (chk.ok) homeText = htmlToText(chk.body).slice(0, 6000);
      if (!chk.ok) website = null;
    }
    let careersPage: string | null = null;
    if (website) {
      for (const p of ['/careers', '/jobs', '/company/careers']) {
        const u = website.replace(/\/$/, '') + p;
        const r = await ctx.tools['http.checkUrl'](u);
        if (r.ok) { careersPage = r.finalUrl || u; log.push({ step: 'Careers page', url: careersPage, result: `HTTP ${r.status}`, ok: true }); break; }
      }
      if (!careersPage) log.push({ step: 'Careers page', result: 'No /careers or /jobs page on the website', ok: false });
    }
    const facts: z.infer<typeof Fact>[] = [];
    if (input.aboutSection) facts.push({ fact: input.aboutSection.slice(0, 500), source_url: input.listingUrl, verified: false });
    ctx.markEngine('rules');
    if (homeText.length > 200 && ctx.llm.enabled) {
      const r = await ctx.llm.json(z.object({ facts: z.array(z.object({ fact: z.string(), quote: z.string() })).max(3) }), `COMPANY: ${input.company}\nPAGE (${website}):\n${homeText}`);
      for (const f of r?.facts ?? []) if (quoteInText(f.quote, homeText)) facts.unshift({ fact: f.fact, source_url: website!, verified: true });
      ctx.log(`${facts.filter((f) => f.verified).length} quote-verified facts from the official website`);
    }
    return { website, websiteVerified, careersPage, facts: facts.slice(0, 4), log };
  },
});
