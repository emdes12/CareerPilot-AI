import { z } from 'zod';
import { extractRequirements } from '../engine/extract.js';
import { defineAgent } from './core/types.js';
import { ExtractionZ, quoteInText, type JobExtraction } from './schemas.js';

const LlmOut = z.object({
  skills: z.array(z.object({ key: z.string(), importance: z.enum(['required', 'preferred', 'mentioned']), quote: z.string() })).default([]),
  other_requirements: z.array(z.object({ text: z.string(), importance: z.enum(['required', 'preferred', 'mentioned']), quote: z.string() })).default([]),
  years_min: z.number().nullable().default(null),
  years_quote: z.string().nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  location_statements: z.array(z.string()).default([]),
  salary_statements: z.array(z.string()).default([]),
  application_instructions: z.array(z.string()).default([]),
});

const lines = (text: string, re: RegExp, n = 6) =>
  [...new Set(text.split(/\n|(?<=[.!?])\s+/).map((l) => l.replace(/^[•\-*\s]+/, '').trim()).filter((l) => l.length > 12 && l.length < 300 && re.test(l)))].slice(0, n);

export const jdExtractionAgent = defineAgent({
  name: 'jd-extraction',
  version: '1.0.0',
  description: 'Extracts structured requirements, seniority, location/salary statements and application instructions from a full job description.',
  modelClass: 'research',
  systemPrompt: `You are the Job Description Extraction Agent for a personal job-search assistant.
Your only task: read ONE job description and extract what it explicitly states. You never evaluate the candidate.
Rules:
- Every extracted item must include "quote": an exact, verbatim excerpt (under 200 characters) copied from the description that supports it. Items without a verbatim quote will be discarded.
- Map technologies ONLY to the taxonomy keys provided. Anything that is not a taxonomy technology (domain experience, soft skills, degrees, etc.) goes in other_requirements.
- importance: "required" (must-have/requirements), "preferred" (nice-to-have/bonus/plus), "mentioned" (appears in duties/stack but not stated as a requirement).
- location_statements: verbatim sentences about where candidates may live/work, time zones, work authorisation, travel, office attendance.
- salary_statements: verbatim sentences stating pay. Do not compute or guess.
- application_instructions: verbatim sentences telling applicants how to apply or what to include.
- Do not infer, assume or embellish.`,
  input: z.object({ jobId: z.number(), title: z.string(), description: z.string(), taxonomyKeys: z.array(z.string()) }),
  output: ExtractionZ,
  tools: ['taxonomy.label', 'taxonomy.detect'],
  dependsOn: [],
  retry: { attempts: 2, backoffMs: 3000 },
  timeoutMs: 180000,
  async run(ctx, input): Promise<JobExtraction> {
    // Deterministic baseline (always computed): literal taxonomy detection + section heuristics.
    const base = extractRequirements(input.title, input.description);
    const out: JobExtraction = {
      ...base,
      requirements: base.requirements.map((r) => ({ ...r, evidence: null })),
      otherRequirements: [],
      locationStatements: lines(input.description, /(remote|located|location|based in|reside|time ?zone|utc|gmt|authori[sz]|countr|office|on-?site|hybrid|travel|relocat)/i),
      salaryStatements: lines(input.description, /([$€£₦]\s?\d|\b(usd|eur|gbp|cad)\b\s?\d|salary|compensation|pay range)/i, 4),
      applicationInstructions: lines(input.description, /(to apply|apply (by|via|through|at)|send (us|your)|email (us|your)|include (a|your)|subject line|cover letter|portfolio)/i, 5),
    };
    ctx.markEngine('rules');
    if (!ctx.llm.enabled) return out;

    const llm = await ctx.llm.json(LlmOut, `TAXONOMY KEYS: ${input.taxonomyKeys.join(', ')}\n\nJOB TITLE: ${input.title}\n\nJOB DESCRIPTION:\n${input.description.slice(0, 14000)}`);
    if (!llm) return out;

    const keys = new Set(input.taxonomyKeys);
    let rejected = 0;
    for (const s of llm.skills) {
      if (!keys.has(s.key) || !quoteInText(s.quote, input.description)) { rejected++; continue; }
      const cur = out.requirements.find((r) => r.skill === s.key);
      if (cur) { cur.importance = s.importance; cur.evidence = s.quote; }
      else out.requirements.push({ skill: s.key, label: ctx.tools['taxonomy.label'](s.key), importance: s.importance, mentions: 1, evidence: s.quote });
    }
    out.otherRequirements = llm.other_requirements.filter((o) => quoteInText(o.quote, input.description) || (rejected++, false)).slice(0, 15);
    if (llm.years_min !== null && llm.years_quote && quoteInText(llm.years_quote, input.description) && llm.years_quote.includes(String(llm.years_min))) out.yearsMin = llm.years_min;
    const verified = (arr: string[]) => arr.filter((x) => quoteInText(x, input.description));
    out.locationStatements = [...new Set([...verified(llm.location_statements), ...out.locationStatements])].slice(0, 8);
    out.salaryStatements = [...new Set([...verified(llm.salary_statements), ...out.salaryStatements])].slice(0, 5);
    out.applicationInstructions = [...new Set([...verified(llm.application_instructions), ...out.applicationInstructions])].slice(0, 6);
    if (llm.responsibilities.length) out.responsibilities = verified(llm.responsibilities).length ? verified(llm.responsibilities).slice(0, 12) : out.responsibilities;
    ctx.log(`LLM extraction merged; ${rejected} unverifiable item(s) rejected`);
    const order = { required: 0, mentioned: 1, preferred: 2 } as const;
    out.requirements.sort((a, b) => order[a.importance] - order[b.importance] || b.mentions - a.mentions);
    return out;
  },
});
