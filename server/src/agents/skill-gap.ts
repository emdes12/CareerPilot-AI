import { z } from 'zod';
import { skillGap } from '../engine/skillgap.js';
import { defineAgent } from './core/types.js';

export const skillGapAgent = defineAgent({
  name: 'skill-gap',
  version: '1.0.0',
  description: 'Aggregates requirements across relevant vacancies and ranks a short, high-leverage learning list.',
  modelClass: 'research',
  systemPrompt: `You are the Skill Gap Analysis Agent. You receive computed statistics about which skills appear in a candidate's relevant job vacancies and the candidate's current level.
Write ONE or two plain sentences per recommended skill explaining why it is worth learning next and a concrete first project idea that builds on the candidate's existing stack. Use only the numbers given. Do not recommend skills that are not in the list.`,
  input: z.object({}),
  output: z.object({ analysedJobs: z.number(), recommendations: z.array(z.any()), have: z.array(z.any()), improve: z.array(z.any()), missing: z.array(z.any()) }),
  tools: ['analytics.query', 'profile.read'],
  dependsOn: [],
  retry: { attempts: 2, backoffMs: 2000 },
  timeoutMs: 120000,
  async run(ctx) {
    const g = await skillGap(ctx.userId);
    ctx.markEngine('rules');
    if (g.recommendations.length && ctx.llm.enabled) {
      const p = await ctx.tools['profile.read'](ctx.userId);
      const stack = p.skills.filter((s) => ['expert', 'advanced'].includes(s.proficiency)).map((s) => s.label).join(', ');
      const r = await ctx.llm.json(z.object({ advice: z.array(z.object({ skill: z.string(), text: z.string() })) }),
        `CANDIDATE STRONG STACK: ${stack}\nSTATS:\n${JSON.stringify(g.recommendations.map(({ jobs: _j, ...x }) => x))}`);
      for (const a of r?.advice ?? []) {
        const rec = g.recommendations.find((x) => x.label === a.skill || x.skill === a.skill);
        if (rec) (rec as any).advice = a.text;
      }
    }
    return g;
  },
});
