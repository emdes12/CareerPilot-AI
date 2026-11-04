import { one, q } from '../db.js';

/**
 * Vacancy freshness. Aggregators often re-date reposted jobs, so the "effective" publication date is:
 *   1. the official ATS publication date when known (verified), else
 *   2. the earliest date seen for this vacancy across sources (posted dates and first discovery of any duplicate).
 * Dates that only come from an aggregator are shown as "Publication date unverified".
 */
const ATS_SOURCES = new Set(['greenhouse', 'lever', 'ashby', 'workable']);

export const FRESHNESS_BUCKETS = [1, 3, 7, 14, 30] as const;

export async function computeFreshness(jobId: number) {
  const j = await one(`SELECT id, source, posted_at, discovered_at, original_published_at, duplicate_of, fingerprint, user_id, repost_count FROM jobs WHERE id=$1`, [jobId]);
  if (!j) return;
  const canonical = j.duplicate_of ?? j.id;
  // Every listing of the same vacancy (canonical + duplicates on other sources).
  const fam = await q(`SELECT id, source, posted_at, discovered_at, original_published_at, status FROM jobs WHERE user_id=$1 AND (id=$2 OR duplicate_of=$2 OR fingerprint=$3)`, [j.user_id, canonical, j.fingerprint]);
  const atsDates = fam.filter((f) => ATS_SOURCES.has(f.source) && f.posted_at).map((f) => new Date(f.posted_at).getTime());
  const original = [j.original_published_at, ...fam.map((f) => f.original_published_at)].filter(Boolean).map((d) => new Date(d).getTime());
  const verifiedDate = original.length ? Math.min(...original) : atsDates.length ? Math.min(...atsDates) : null;
  const anyDates = fam.flatMap((f) => [f.posted_at, f.discovered_at]).filter(Boolean).map((d) => new Date(d).getTime());
  const earliest = anyDates.length ? Math.min(...anyDates) : null;
  const effective = verifiedDate ?? earliest;
  const sourceKind = original.length ? 'ats' : ATS_SOURCES.has(j.source) && j.posted_at ? 'ats' : j.posted_at ? 'aggregator' : 'none';
  const ownPosted = j.posted_at ? new Date(j.posted_at).getTime() : null;
  // A repost: the source shows a recent date but the same vacancy was seen/published ≥ 7 days earlier.
  const isRepost = j.repost_count > 0 || (ownPosted !== null && effective !== null && ownPosted - effective > 7 * 864e5);
  const note = verifiedDate
    ? (isRepost ? `Re-listed; originally published ${new Date(verifiedDate).toISOString().slice(0, 10)} on the employer's ATS` : 'Publication date from the employer\'s ATS')
    : sourceKind === 'aggregator' ? (isRepost ? 'Publication date unverified — this vacancy was seen earlier, so the newer aggregator date is ignored' : 'Publication date unverified (aggregator date)')
      : 'Publication date unverified — using the date CareerPilot first saw it';
  await q(`UPDATE jobs SET posted_at_source=$2, effective_published_at=$3, publication_verified=$4, publication_note=$5, is_repost=$6 WHERE id=$1`,
    [jobId, sourceKind, effective ? new Date(effective) : null, !!verifiedDate, note, isRepost]);
}

export async function computeAllFreshness(userId: number) {
  const ids = await q<{ id: number }>(`SELECT id FROM jobs WHERE user_id=$1`, [userId]);
  for (const { id } of ids) await computeFreshness(id);
  return ids.length;
}

export const ageDays = (d: Date | string | null | undefined, now = new Date()) => (d ? (now.getTime() - new Date(d).getTime()) / 864e5 : null);

/** Freshness factor 0..1 used for scoring and ranking. */
export function freshnessFactor(age: number | null) {
  if (age === null) return 0.5;
  return age <= 1 ? 1 : age <= 3 ? 0.9 : age <= 7 ? 0.75 : age <= 14 ? 0.55 : age <= 30 ? 0.35 : 0.1;
}
