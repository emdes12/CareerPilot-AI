import { z } from 'zod';
import { matchRequirement } from '../engine/scoring.js';
import { defineAgent } from './core/types.js';
import { MatchZ, RequirementZ } from './schemas.js';

/**
 * Skill Matching Agent. Taxonomy requirements are matched deterministically against the master profile.
 * The LLM only judges non-taxonomy requirements (e.g. "experience building booking systems") and must
 * cite a profile item by its exact name; citations to non-existent items are discarded.
 */
export const skillMatchingAgent = defineAgent({
  name: 'skill-matching',
  version: '1.0.0',
  description: 'Compares each extracted requirement with the master profile: proficiency, professional/project use, evidence, transferable skills.',
  modelClass: 'scoring',
  systemPrompt: `You are the Skill Matching Agent. You compare non-technology job requirements with a candidate's VERIFIED profile items.
For each requirement return match: "strong" | "partial" | "missing", and "cites": exact names of profile items (experience companies or project names) that support it.
Be strict: if the profile items don't clearly show it, answer "missing". Never assume unstated experience.`,
  input: z.object({ jobId: z.number(), requirements: z.array(RequirementZ), otherRequirements: z.array(z.object({ text: z.string(), importance: z.string(), quote: z.string() })) }),
  output: z.object({ matches: z.array(MatchZ), other: z.array(z.object({ text: z.string(), importance: z.string(), match: z.enum(['strong', 'partial', 'missing']), cites: z.array(z.string()) })) }),
  tools: ['profile.read'],
  dependsOn: ['jd-extraction'],
  retry: { attempts: 2, backoffMs: 2000 },
  timeoutMs: 120000,
  async run(ctx, input) {
    const p = await ctx.tools['profile.read'](ctx.userId);
    const matches = input.requirements.map((r) => matchRequirement({ ...r, mentions: r.mentions }, p));
    ctx.markEngine('rules');
    let other: { text: string; importance: string; match: 'strong' | 'partial' | 'missing'; cites: string[] }[] = input.otherRequirements.map((o) => ({ text: o.text, importance: o.importance, match: 'missing', cites: [] }));
    if (input.otherRequirements.length && ctx.llm.enabled) {
      const items = [
        ...p.experiences.map((e: any) => ({ name: e.company, kind: 'experience', title: e.title, details: (e.bullets ?? []).join(' ') })),
        ...p.projects.map((pr: any) => ({ name: pr.name, kind: 'project', details: `${pr.problem ?? ''} ${pr.contribution ?? ''}` })),
      ];
      const r = await ctx.llm.json(z.object({ results: z.array(z.object({ index: z.number(), match: z.enum(['strong', 'partial', 'missing']), cites: z.array(z.string()) })) }),
        `PROFILE ITEMS:\n${JSON.stringify(items)}\n\nREQUIREMENTS:\n${input.otherRequirements.map((o, i) => `${i}. ${o.text}`).join('\n')}`);
      const names = new Set(items.map((i) => i.name));
      for (const x of r?.results ?? []) {
        if (!other[x.index]) continue;
        const cites = x.cites.filter((c) => names.has(c));
        other[x.index] = { ...other[x.index], match: x.match !== 'missing' && cites.length === 0 ? 'missing' : x.match, cites };
      }
      ctx.log(`Judged ${other.length} non-taxonomy requirements; uncited claims downgraded to missing`);
    }
    return { matches, other };
  },
});
