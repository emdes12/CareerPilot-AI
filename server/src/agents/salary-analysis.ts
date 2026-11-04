import { z } from 'zod';
import { findSalaryInDescription, parseSalaryText, type ParsedSalary } from '../engine/salary.js';
import { defineAgent } from './core/types.js';
import { quoteInText, SalaryZ } from './schemas.js';

export const salaryAnalysisAgent = defineAgent({
  name: 'salary-analysis',
  version: '1.0.0',
  description: 'Determines disclosed compensation (structured fields → salary statements → LLM reading of ambiguous text) and converts to NGN against targets.',
  modelClass: 'research',
  systemPrompt: `You are the Salary Analysis Agent. You receive verbatim salary sentences from a job listing.
If (and only if) they state a pay amount, return min, max (or null), ISO currency code, and period (year|month|hour), plus "quote" copied verbatim.
If no amount is stated, return {"found": false}. Never estimate market rates.`,
  input: z.object({
    jobId: z.number(), structured: z.object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string().nullable(), period: z.string().nullable(), raw: z.string().nullable() }),
    salaryStatements: z.array(z.string()), description: z.string(),
  }),
  output: SalaryZ,
  tools: ['fx.analyse', 'settings.read'],
  dependsOn: ['jd-extraction'],
  retry: { attempts: 2, backoffMs: 2000 },
  timeoutMs: 90000,
  async run(ctx, input) {
    const s = await ctx.tools['settings.read'](ctx.userId);
    let parsed: ParsedSalary | null = null; let quote: string | null = null;
    const st = input.structured;
    if (st.min) parsed = { min: st.min, max: st.max, currency: st.currency, period: (st.period as any) ?? 'year', raw: st.raw, source: 'listing' };
    if (!parsed && st.raw) parsed = parseSalaryText(st.raw, 'listing');
    if (!parsed) for (const l of input.salaryStatements) { parsed = parseSalaryText(l, 'description'); if (parsed) { quote = l; break; } }
    if (!parsed) parsed = findSalaryInDescription(input.description);
    ctx.markEngine('rules');
    if (!parsed && input.salaryStatements.length && ctx.llm.enabled) {
      const src = input.salaryStatements.join('\n');
      const r = await ctx.llm.json(z.object({ found: z.boolean(), min: z.number().nullable().optional(), max: z.number().nullable().optional(), currency: z.string().nullable().optional(), period: z.enum(['year', 'month', 'hour']).nullable().optional(), quote: z.string().nullable().optional() }), `SALARY SENTENCES:\n${src}`);
      if (r?.found && r.min && r.quote && quoteInText(r.quote, src) && /\d/.test(r.quote)) {
        parsed = { min: r.min, max: r.max ?? null, currency: r.currency ?? null, period: r.period ?? 'year', raw: r.quote, source: 'description' };
        quote = r.quote;
        ctx.log('Salary read by LLM from a verified quote');
      }
    }
    const a = ctx.tools['fx.analyse'](parsed, s.fx_rates, Number(s.min_salary_ngn_monthly), Number(s.target_salary_ngn_monthly));
    return { ...a, fxDate: s.fx_updated_at ? new Date(s.fx_updated_at).toISOString().slice(0, 10) : null, sourceQuote: quote ?? parsed?.raw ?? null };
  },
});
