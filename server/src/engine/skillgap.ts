import { q } from '../db.js';
import { labelOf, skillDef } from '../lib/taxonomy.js';
import { loadProfile } from './profile.js';

/**
 * Skill Gap Analysis Agent: aggregates requirements across relevant, non-duplicate vacancies
 * (fully remote software roles that are not hard-blocked by location) and ranks what to learn.
 */
export async function skillGap(userId: number) {
  const p = await loadProfile(userId);
  const rows = await q<{ id: number; title: string; company_name: string; total_score: number; requirements: any[]; status: string; eligibility: any }>(
    `SELECT j.id, j.title, j.company_name, a.total_score, a.requirements, j.status, a.eligibility
     FROM jobs j JOIN job_analyses a ON a.job_id=j.id
     WHERE j.user_id=$1 AND j.duplicate_of IS NULL AND (a.experience->>'roleType') IN ('fullstack','frontend','backend','general')`, [userId]);
  const relevant = rows.filter((r) => r.eligibility?.status !== 'ineligible');
  const N = relevant.length;
  const stats = new Map<string, { skill: string; required: number; any: number; jobs: { id: number; title: string; company: string; score: number }[]; unlocks: number; nearMiss: number }>();
  for (const j of relevant) {
    const reqMissing = j.requirements.filter((r: any) => r.importance === 'required' && r.match === 'missing');
    for (const r of j.requirements) {
      const s = stats.get(r.skill) ?? { skill: r.skill, required: 0, any: 0, jobs: [] as { id: number; title: string; company: string; score: number }[], unlocks: 0, nearMiss: 0 };
      s.any++; if (r.importance === 'required') s.required++;
      if (s.jobs.length < 25) s.jobs.push({ id: j.id, title: j.title, company: j.company_name, score: j.total_score });
      if (r.match !== 'strong' && r.importance === 'required') {
        if (reqMissing.length === 1 && reqMissing[0].skill === r.skill) s.unlocks++;
        if (j.total_score >= 55 && j.total_score < 80) s.nearMiss++;
      }
      stats.set(r.skill, s);
    }
  }
  const skills = [...stats.values()].map((s) => {
    const own = p.skillMap.get(s.skill);
    const demand = N ? s.any / N : 0;
    const state = !own ? 'missing' : ['learning', 'basic'].includes(own.proficiency) || !own.professional ? 'improve' : 'have';
    const gapFactor = state === 'missing' ? 1 : state === 'improve' ? 0.6 : 0;
    const related = (skillDef(s.skill)?.related ?? []).some((k) => p.skillMap.has(k));
    const priority = Math.round((demand * 60 + (N ? (s.unlocks / N) * 200 : 0) + (N ? (s.nearMiss / N) * 60 : 0)) * gapFactor * (related ? 1.15 : 1) * 10) / 10;
    return { skill: s.skill, label: labelOf(s.skill), category: skillDef(s.skill)?.category ?? 'other', demandPct: Math.round(demand * 100), requiredIn: s.required, mentionedIn: s.any,
      yourLevel: own?.proficiency ?? null, professional: own?.professional ?? false, state, unlocks: s.unlocks, nearMiss: s.nearMiss, priority, jobs: s.jobs.sort((a, b) => b.score - a.score).slice(0, 10) };
  }).sort((a, b) => b.mentionedIn - a.mentionedIn);
  // Recommend a focused shortlist only: meaningful demand, a real gap, and not exotic.
  const recommendations = skills.filter((s) => s.state !== 'have' && s.demandPct >= 8 && s.mentionedIn >= 3).sort((a, b) => b.priority - a.priority).slice(0, 5)
    .map((s, i) => ({ rank: i + 1, ...s, why: `${s.label} appears in ${s.demandPct}% of ${N} relevant vacancies (required in ${s.requiredIn}).${s.unlocks ? ` It is the only missing requirement in ${s.unlocks} job(s).` : ''}${s.yourLevel ? ` You are currently “${s.yourLevel}”${s.professional ? '' : ', not yet used professionally'}.` : ''}` }));
  return { analysedJobs: N, have: skills.filter((s) => s.state === 'have'), improve: skills.filter((s) => s.state === 'improve'), missing: skills.filter((s) => s.state === 'missing'), recommendations };
}
