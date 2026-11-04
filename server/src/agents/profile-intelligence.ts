import { z } from 'zod';
import { detectSkills, labelOf } from '../lib/taxonomy.js';
import { htmlToText } from '../lib/text.js';
import { defineAgent } from './core/types.js';
import { quoteInText } from './schemas.js';

/**
 * Professional Profile Intelligence Agent: gathers public evidence (GitHub repos, portfolio page) and
 * produces SUGGESTIONS only. It never edits the master profile; the user accepts or dismisses each one.
 */
export const profileIntelligenceAgent = defineAgent({
  name: 'profile-intelligence',
  version: '1.0.0',
  description: 'Mines GitHub and portfolio evidence for skills/projects missing from the profile and flags gaps — as reviewable suggestions.',
  modelClass: 'research',
  systemPrompt: `You are the Profile Intelligence Agent. From the candidate's own portfolio page text, list projects or experiences that appear to be missing from their profile.
Each item needs "quote": verbatim text from the page. Do not infer responsibilities, dates or team size that are not written.`,
  input: z.object({ githubUser: z.string().nullable(), portfolioUrl: z.string().nullable() }),
  output: z.object({ suggestions: z.array(z.object({ kind: z.enum(['skill', 'project', 'flag']), payload: z.any(), evidence: z.string(), sourceUrl: z.string().nullable() })) }),
  tools: ['github.listRepos', 'http.fetchPublic', 'profile.read'],
  dependsOn: [],
  retry: { attempts: 2, backoffMs: 3000 },
  timeoutMs: 180000,
  async run(ctx, input) {
    const p = await ctx.tools['profile.read'](ctx.userId);
    const have = new Set(p.skills.map((s) => s.name));
    const suggestions: { kind: 'skill' | 'project' | 'flag'; payload: any; evidence: string; sourceUrl: string | null }[] = [];
    ctx.markEngine('rules');
    if (input.githubUser) {
      try {
        const repos = (await ctx.tools['github.listRepos'](input.githubUser)).filter((r) => !r.fork);
        const evidence = new Map<string, string[]>();
        for (const r of repos) {
          const keys = new Set<string>([...detectSkills(`${r.language ?? ''} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`).keys()]);
          if (r.language === 'PHP') keys.add('php');
          for (const k of keys) evidence.set(k, [...(evidence.get(k) ?? []), r.name]);
        }
        for (const [k, names] of evidence) {
          if (have.has(k)) continue;
          suggestions.push({ kind: 'skill', payload: { name: k, label: labelOf(k), proficiencyHint: names.length >= 3 ? 'intermediate' : 'basic' }, evidence: `Public repos: ${names.slice(0, 5).join(', ')}`, sourceUrl: `https://github.com/${input.githubUser}` });
        }
        const linked = new Set(p.projects.map((x: any) => x.repo_url).filter(Boolean));
        for (const r of repos.filter((r) => r.homepage && !linked.has(r.html_url)).slice(0, 8)) {
          suggestions.push({ kind: 'project', payload: { name: r.name, url: r.homepage, repo_url: r.html_url, technologies: [...detectSkills(r.language ?? '').keys()] }, evidence: `Repo with live site, last pushed ${String(r.pushed_at).slice(0, 10)}`, sourceUrl: r.html_url });
        }
        ctx.log(`Scanned ${repos.length} public repos`);
      } catch (e) { ctx.log(`GitHub scan failed: ${(e as Error).message}`); }
    }
    if (input.portfolioUrl && ctx.llm.enabled) {
      try {
        const page = htmlToText((await ctx.tools['http.fetchPublic'](input.portfolioUrl)).text).slice(0, 8000);
        if (page.length > 300) {
          const r = await ctx.llm.json(z.object({ items: z.array(z.object({ name: z.string(), summary: z.string(), quote: z.string() })).max(8) }),
            `KNOWN PROFILE ITEMS: ${[...p.experiences.map((e: any) => e.company), ...p.projects.map((x: any) => x.name)].join(', ')}\n\nPORTFOLIO PAGE TEXT:\n${page}`);
          for (const it of r?.items ?? []) if (quoteInText(it.quote, page)) suggestions.push({ kind: 'project', payload: { name: it.name, problem: it.summary }, evidence: it.quote, sourceUrl: input.portfolioUrl });
        } else ctx.log('Portfolio is a client-rendered page with little server HTML; skipped text analysis');
      } catch (e) { ctx.log(`Portfolio fetch failed: ${(e as Error).message}`); }
    }
    for (const f of (p.profile.verification_flags ?? []) as any[]) suggestions.push({ kind: 'flag', payload: f, evidence: f.message, sourceUrl: null });
    return { suggestions };
  },
});
