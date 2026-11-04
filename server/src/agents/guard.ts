import { labelOf } from '../lib/taxonomy.js';
import type { FullProfile } from '../engine/profile.js';
import { unsupportedSkills } from '../docs/generate.js';
import { BANNED_PHRASES } from '../docs/style.js';

/**
 * Truthfulness guard (deterministic): an AI rewrite is accepted only if it introduces no technology
 * that is absent from the profile/draft, no new numbers, and keeps every [PLACEHOLDER].
 */
export function guardRewrite(draft: string, rewrite: string | null, p: FullProfile): { text: string; accepted: boolean; reason: string | null } {
  if (!rewrite) return { text: draft, accepted: false, reason: null };
  const newSkills = unsupportedSkills(rewrite, p).filter((k) => !unsupportedSkills(draft, p).includes(k));
  const nums = (s: string) => new Set(s.match(/\b\d+(?:[.,]\d+)?%?/g) ?? []);
  const draftNums = nums(draft);
  const newNums = [...nums(rewrite)].filter((n) => !draftNums.has(n));
  const placeholders = draft.match(/\[[A-Z][^\]]*\]/g) ?? [];
  const lost = placeholders.filter((ph) => !rewrite.includes(ph));
  if (newSkills.length) return { text: draft, accepted: false, reason: `AI rewrite rejected: added ${newSkills.map(labelOf).join(', ')}, which is not in your profile.` };
  if (newNums.length) return { text: draft, accepted: false, reason: `AI rewrite rejected: introduced new figures (${newNums.slice(0, 3).join(', ')}).` };
  if (lost.length) return { text: draft, accepted: false, reason: 'AI rewrite rejected: removed a placeholder that needs your input.' };
  const banned = BANNED_PHRASES.filter((b) => rewrite.toLowerCase().includes(b) && !draft.toLowerCase().includes(b));
  if (banned.length) return { text: draft, accepted: false, reason: `AI rewrite rejected: generic phrasing (“${banned[0]}”).` };
  const names = [...p.projects.map((x: any) => x.name), ...p.experiences.map((x: any) => x.company)].filter((n) => draft.includes(n));
  const dropped = names.filter((n) => !rewrite.includes(n));
  if (dropped.length) return { text: draft, accepted: false, reason: `AI rewrite rejected: dropped the reference to ${dropped.join(', ')}.` };
  if (rewrite.length > draft.length * 1.6) return { text: draft, accepted: false, reason: 'AI rewrite rejected: too long versus the source draft.' };
  return { text: rewrite.trim(), accepted: true, reason: null };
}
