import { z } from 'zod';
import { applicationEmailOpening, buildAnswers, buildCoverLetter } from '../docs/generate.js';
import { STYLE_GUIDE } from '../docs/style.js';
import { defineAgent } from './core/types.js';
import { guardRewrite } from './guard.js';

export const coverLetterAgent = defineAgent({
  name: 'cover-letter',
  version: '1.0.0',
  description: 'Writes the tailored cover letter, application email (verified address only), short intro and screening answers.',
  modelClass: 'documents',
  systemPrompt: `You are the Cover Letter Agent. Rewrite the DRAFT cover letter so it is specific to the company and role, warm but professional, concise (under 300 words), in international English.
STRICT: do not add any skill, technology, employer, metric, number, achievement or date that is not in the DRAFT. Keep honest statements about gaps. Keep every [PLACEHOLDER]. Keep every project and employer name that the DRAFT mentions.
${STYLE_GUIDE}
Separate paragraphs with a blank line. Return only the letter body (no greeting, no sign-off).`,
  input: z.object({ jobId: z.number(), job: z.any(), analysis: z.any(), research: z.any().nullable() }),
  output: z.object({ coverLetter: z.any(), email: z.any(), answers: z.any(), warnings: z.array(z.string()) }),
  tools: ['profile.read', 'settings.read', 'guard.unsupportedSkills'],
  dependsOn: ['skill-matching', 'application-research'],
  retry: { attempts: 2, backoffMs: 2000 },
  timeoutMs: 150000,
  async run(ctx, input) {
    const p = await ctx.tools['profile.read'](ctx.userId);
    const job = { ...input.job, __strong: (input.analysis.requirements ?? []).filter((r: any) => r.match === 'strong').map((r: any) => r.label) };
    const cl = buildCoverLetter(p, job, input.analysis, input.research);
    ctx.markEngine('rules');
    const warnings: string[] = [];
    let body = cl.paragraphs.join('\n\n');
    if (ctx.llm.enabled) {
      const r = await ctx.llm.text(`COMPANY: ${job.company_name}\nROLE: ${job.title}\nJOB EXCERPT:\n${(job.description_text ?? '').slice(0, 3500)}\n\nDRAFT:\n${body}`, { maxTokens: 1500 });
      const g = guardRewrite(body, r, p);
      body = g.text;
      if (g.reason) warnings.push(g.reason);
    }
    const coverLetter = { recipient: `Hiring Team, ${job.company_name}`, subject: job.title, paragraphs: body.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean), signoff: cl.signoff };
    // The email is addressed ONLY to an address the listing explicitly published (found by application-research).
    const to = input.research?.apply_email ?? null;
    const email = {
      to, toVerified: !!to,
      subject: `Application: ${job.title} — ${p.profile.full_name}`,
      body: `${applicationEmailOpening(job)}\n\n${coverLetter.paragraphs[1] ?? coverLetter.paragraphs[0] ?? ''}\n\nPortfolio: ${p.profile.links?.portfolio}\nGitHub: ${p.profile.links?.github}\nLinkedIn: ${p.profile.links?.linkedin}\n\nKind regards,\n${p.profile.full_name}\n${p.profile.phone}`,
      note: to ? 'Recipient taken verbatim from the job listing.' : 'No application email was published for this role — apply via the official link.',
    };
    const answers = await buildAnswers(p, job, input.research, ctx.userId);
    if ([...answers.formQuestions, ...answers.common].some((a: any) => /\[(NEEDS|ADD|CONFIRM|REVIEW|PERSONALISE)/.test(a.answer))) warnings.push('Some answers need your input — look for [BRACKETED] markers.');
    return { coverLetter, email, answers, warnings };
  },
});
