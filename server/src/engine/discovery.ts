import { json, one, q } from '../db.js';
import { SOURCES } from '../sources/index.js';
import type { RawJob } from '../sources/types.js';
import { isSoftwareRole } from './extract.js';
import { loadProfile } from './profile.js';
import { getSettings } from './settings.js';
import { analyseJob, upsertJob } from './store.js';
import { assessEligibility } from './eligibility.js';

let running = false;
export const isDiscoveryRunning = () => running;

/** Pre-store filter: software role, remote (not on-site/hybrid), fresh enough. */
export function relevant(r: RawJob, maxAgeDays: number, now = new Date()): { ok: boolean; reason?: string } {
  if (!r.title || !r.company || !r.sourceUrl) return { ok: false, reason: 'incomplete' };
  if (!isSoftwareRole(r.title, r.descriptionText ?? '')) return { ok: false, reason: 'not a software role' };
  if (r.postedAt && (now.getTime() - r.postedAt.getTime()) / 864e5 > maxAgeDays) return { ok: false, reason: 'too old' };
  // For ATS boards (which include on-site roles), require a remote signal.
  if (['greenhouse', 'lever', 'ashby', 'workable'].includes(r.source)) {
    const raw: any = r.raw ?? {};
    const remote = /remote|anywhere|distributed|worldwide/i.test(`${r.locationRaw ?? ''} ${r.title}`) || raw.isRemote || raw.telecommuting || /remote/i.test(raw.workplaceType ?? '');
    if (!remote) return { ok: false, reason: 'not remote' };
  }
  const e = assessEligibility({ title: r.title, locationRaw: r.locationRaw, locationRestrictions: r.locationRestrictions, timezoneRestrictions: r.timezoneRestrictions, description: r.descriptionText, source: r.source });
  if (e.workArrangement === 'onsite' || e.workArrangement === 'hybrid') return { ok: false, reason: 'not fully remote' };
  return { ok: true };
}

export async function runDiscovery(userId: number, trigger: 'manual' | 'schedule', onlySources?: string[]) {
  if (running) throw new Error('A discovery run is already in progress');
  running = true;
  const run = await one<{ id: number }>('INSERT INTO search_runs (user_id, trigger) VALUES ($1,$2) RETURNING id', [userId, trigger]);
  const runId = run!.id;
  const totals = { fetched: 0, relevant: 0, inserted: 0, updated: 0, duplicates: 0, reposts: 0, analysed: 0, failedSources: 0 };
  const newJobIds: number[] = [];
  try {
    const s = await getSettings(userId);
    const profile = await loadProfile(userId);
    const sources = SOURCES.filter((x) => x.available && s.enabled_sources.includes(x.id) && (!onlySources || onlySources.includes(x.id)));
    for (const src of sources) {
      const t0 = Date.now();
      const logs: string[] = [];
      let stat = { fetched: 0, relevant: 0, inserted: 0, updated: 0 };
      let attempts = 0; let error: string | null = null;
      for (attempts = 1; attempts <= 2; attempts++) {
        try {
          const jobs = await src.fetch({ keywords: s.keywords, boards: s.company_boards, maxAgeDays: s.max_age_days, log: (m) => logs.push(m) });
          stat = { fetched: jobs.length, relevant: 0, inserted: 0, updated: 0 };
          for (const r of jobs) {
            if (!relevant(r, s.max_age_days).ok) continue;
            stat.relevant++;
            try {
              const res = await upsertJob(userId, r);
              if (res.inserted) stat.inserted++; else stat.updated++;
              if (res.duplicateOf) totals.duplicates++;
              if (res.repost) totals.reposts++;
              if (!res.duplicateOf) { await analyseJob(userId, res.id, profile); totals.analysed++; if (res.inserted) newJobIds.push(res.id); }
            } catch (e) { logs.push(`store ${r.sourceUrl}: ${(e as Error).message}`); }
          }
          error = null;
          break;
        } catch (e) {
          error = (e as Error).message;
          if (attempts < 2) await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (error) totals.failedSources++;
      totals.fetched += stat.fetched; totals.relevant += stat.relevant; totals.inserted += stat.inserted; totals.updated += stat.updated;
      await q(`INSERT INTO source_logs (run_id, source, status, fetched, relevant, inserted, updated, duration_ms, error, attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [runId, src.id, error ? 'error' : logs.length ? 'partial' : 'ok', stat.fetched, stat.relevant, stat.inserted, stat.updated, Date.now() - t0, error ?? (logs.length ? logs.slice(0, 20).join('\n') : null), attempts]);
    }
    await q(`UPDATE search_runs SET finished_at=now(), status=$2, stats=$3 WHERE id=$1`, [runId, totals.failedSources ? 'completed_with_errors' : 'completed', json(totals)]);
    return { runId, ...totals, newJobIds };
  } catch (e) {
    await q(`UPDATE search_runs SET finished_at=now(), status='failed', stats=$2 WHERE id=$1`, [runId, json({ ...totals, error: (e as Error).message })]);
    throw e;
  } finally {
    running = false;
  }
}
