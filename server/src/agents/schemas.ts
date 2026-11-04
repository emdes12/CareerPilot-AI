import { z } from 'zod';

/** Structured records shared between agents (persisted in Postgres, never passed as chat). */

export const Importance = z.enum(['required', 'preferred', 'mentioned']);
export const RequirementZ = z.object({ skill: z.string(), label: z.string(), importance: Importance, mentions: z.number(), evidence: z.string().nullable().optional() });

export const ExtractionZ = z.object({
  requirements: z.array(RequirementZ),
  otherRequirements: z.array(z.object({ text: z.string(), importance: Importance, quote: z.string() })),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'lead', 'staff', 'unknown']),
  yearsMin: z.number().nullable(),
  yearsMax: z.number().nullable(),
  roleType: z.enum(['frontend', 'backend', 'fullstack', 'mobile', 'devops', 'data', 'ml', 'qa', 'general', 'other']),
  languageRequirements: z.array(z.string()),
  clearance: z.boolean(),
  responsibilities: z.array(z.string()),
  requirementLines: z.array(z.string()),
  screeningHints: z.array(z.string()),
  locationStatements: z.array(z.string()),
  salaryStatements: z.array(z.string()),
  applicationInstructions: z.array(z.string()),
});
export type JobExtraction = z.infer<typeof ExtractionZ>;

export const MatchZ = RequirementZ.extend({
  match: z.enum(['strong', 'partial', 'transferable', 'missing']), proficiency: z.string().nullable(), professional: z.boolean(),
  inProjects: z.boolean(), evidence: z.string().nullable(), credit: z.number(), note: z.string(),
});

export const SalaryZ = z.object({
  status: z.enum(['meets_target', 'meets_minimum', 'below_minimum', 'not_disclosed', 'unconvertible']), disclosed: z.boolean(), original: z.string().nullable(),
  ngnMonthlyMin: z.number().nullable(), ngnMonthlyMax: z.number().nullable(), verified: z.boolean(), note: z.string(), score01: z.number(),
  fxDate: z.string().nullable().optional(), sourceQuote: z.string().nullable().optional(),
});

export const JobRef = z.object({ jobId: z.number().int().positive() });

/** True when `quote` appears verbatim (whitespace/case-insensitive) in `source`. Used to reject hallucinated extractions. */
export function quoteInText(quote: string | null | undefined, source: string): boolean {
  if (!quote || quote.length < 3) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[“”"'’‘`*_•]/g, '').replace(/\s+/g, ' ').trim();
  const q = norm(quote); const src = norm(source);
  if (src.includes(q)) return true;
  // Accept long quotes whose first 60 normalised chars match (LLMs sometimes trim endings).
  return q.length > 60 && src.includes(q.slice(0, 60));
}
