import { q, one } from '../db.js';
import { applyEvidence, listClaims, type EvidenceView } from './evidence.js';

export type Proficiency = 'expert' | 'advanced' | 'intermediate' | 'basic' | 'learning';
export interface SkillRow { name: string; label: string; category: string; proficiency: Proficiency; professional: boolean; years: number | null; evidence: string | null }
export interface FullProfile {
  profile: any; skills: SkillRow[]; experiences: any[]; projects: any[]; education: any[];
  skillMap: Map<string, SkillRow>; projectSkills: Set<string>; experienceSkills: Set<string>; professionalYears: number;
  /** Present when the profile was built from the evidence base (the default for all agents and documents). */
  evidence?: EvidenceView;
}

/** Years of professional (non-intern) experience, from the earliest confirmed start date. */
export function computeYears(experiences: { start_date: string | null; employment_type: string | null; title: string }[], now = new Date()): number {
  const starts = experiences
    .filter((e) => e.start_date && !/intern/i.test(`${e.employment_type ?? ''} ${e.title}`))
    .map((e) => { const [y, m] = String(e.start_date).split('-').map(Number); return new Date(y, (m || 1) - 1, 1); });
  if (!starts.length) return 0;
  const earliest = Math.min(...starts.map((d) => d.getTime()));
  return Math.round(((now.getTime() - earliest) / (365.25 * 864e5)) * 10) / 10;
}

/**
 * Load the master profile. By default it is evidence-backed: experience titles, dates, bullets and
 * technologies come only from verified / user-confirmed evidence claims (see engine/evidence.ts).
 * `{ raw: true }` returns the editable profile rows as stored.
 */
export async function loadProfile(userId: number, opts: { raw?: boolean } = {}): Promise<FullProfile> {
  const [profile, skills, rawExperiences, rawProjects, education, claims] = await Promise.all([
    one('SELECT * FROM profiles WHERE user_id=$1', [userId]),
    q<SkillRow>('SELECT name,label,category,proficiency,professional,years,evidence FROM skills WHERE user_id=$1 ORDER BY id', [userId]),
    q('SELECT * FROM experiences WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
    q('SELECT * FROM projects WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
    q('SELECT * FROM education WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
    opts.raw ? Promise.resolve([]) : listClaims(userId),
  ]);
  let experiences = rawExperiences; let projects = rawProjects; let evidence: EvidenceView | undefined;
  if (!opts.raw && claims.length) ({ experiences, projects, evidence } = applyEvidence({ experiences: rawExperiences, projects: rawProjects }, claims));
  const skillMap = new Map(skills.map((s) => [s.name, s]));
  const projectSkills = new Set<string>(projects.flatMap((p: any) => p.technologies ?? []));
  const experienceSkills = new Set<string>(experiences.flatMap((e: any) => e.technologies ?? []));
  return { profile, skills, experiences, projects, education, skillMap, projectSkills, experienceSkills, professionalYears: computeYears(experiences), evidence };
}
