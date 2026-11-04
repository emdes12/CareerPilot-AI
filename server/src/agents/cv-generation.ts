import { z } from 'zod';
import { buildCv } from '../docs/generate.js';
import { STYLE_GUIDE } from '../docs/style.js';
import { labelOf } from '../lib/taxonomy.js';
import { defineAgent } from './core/types.js';
import { guardRewrite } from './guard.js';
import { MatchZ } from './schemas.js';

export const cvGenerationAgent = defineAgent({
  name: 'cv-generation',
  version: '1.0.0',
  description: 'Builds a tailored, ATS-friendly CV from the master profile for one vacancy (selection and ordering are deterministic; AI may only rephrase the summary).',
  modelClass: 'documents',
  systemPrompt: `You are the CV Generation Agent. Rewrite the DRAFT professional summary so it reads naturally for the target role, in concise international English (max 4 sentences).
STRICT: do not add any skill, technology, employer, metric, number, achievement, title or date that is not in the DRAFT. Use the job's vocabulary only where the DRAFT already supports it. Return only the summary text.
${STYLE_GUIDE}`,
  input: z.object({ jobId: z.number(), job: z.object({ id: z.number(), title: z.string(), company_name: z.string(), description_text: z.string().nullable() }), matches: z.array(MatchZ) }),
  output: z.object({ content: z.any(), warnings: z.array(z.string()), aiSummary: z.boolean() }),
  tools: ['profile.read', 'guard.unsupportedSkills'],
  dependsOn: ['skill-matching'],
  retry: { attempts: 2, backoffMs: 2000 },
  timeoutMs: 120000,
  async run(ctx, input) {
    const p = await ctx.tools['profile.read'](ctx.userId);
    const cv = buildCv(p, input.job, input.matches as any);
    ctx.markEngine('rules');
    const warnings: string[] = [];
    let aiSummary = false;
    if (ctx.llm.enabled) {
      const r = await ctx.llm.text(`TARGET ROLE: ${input.job.title} at ${input.job.company_name}\nJOB EXCERPT:\n${(input.job.description_text ?? '').slice(0, 3000)}\n\nDRAFT SUMMARY:\n${cv.summary}`, { maxTokens: 800 });
      const g = guardRewrite(cv.summary, r, p);
      cv.summary = g.text; aiSummary = g.accepted;
      if (g.reason) warnings.push(g.reason);
    }
    const leak = ctx.tools['guard.unsupportedSkills']([cv.summary, ...cv.skills.flatMap((s) => s.items), ...cv.experience.flatMap((e) => e.bullets)].join('\n'), p);
    if (leak.length) warnings.push(`Check: mentions ${leak.map(labelOf).join(', ')}, not in your skills list.`);
    if (cv.meta.omittedSkills.length) warnings.push(`Not claimed (not in your profile): ${cv.meta.omittedSkills.join(', ')}.`);
    for (const e of p.experiences.filter((e: any) => e.needs_verification)) warnings.push(`Verify before sending: ${e.company} — ${e.verification_note}`);
    return { content: cv, warnings, aiSummary };
  },
});
