import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import cron, { type ScheduledTask } from 'node-cron';
import { config } from './config.js';
import { json, q } from './db.js';
import { isDiscoveryRunning } from './engine/discovery.js';
import { recheckStale } from './engine/recheck.js';
import { getSettings } from './engine/settings.js';
import { fetchFxRates } from './engine/salary.js';

/**
 * Scheduling: in-process cron (works with zero extra infrastructure).
 * If REDIS_URL is set, discovery runs are enqueued on a BullMQ queue instead, giving
 * persistence + retries across restarts (see queue.ts).
 */
let discoveryTask: ScheduledTask | null = null;
const fixed: ScheduledTask[] = [];

export async function scheduleDiscovery(userId: number) {
  discoveryTask?.stop();
  const s = await getSettings(userId);
  if (!s.schedule_enabled || !cron.validate(s.schedule_cron)) return null;
  discoveryTask = cron.schedule(s.schedule_cron, () => { void enqueueDiscovery(userId, 'schedule'); });
  return s.schedule_cron;
}

export async function enqueueDiscovery(userId: number, trigger: 'manual' | 'schedule', sources?: string[]) {
  if (config.redisUrl) {
    const { queueDiscovery } = await import('./queue.js');
    return queueDiscovery(userId, trigger, sources);
  }
  if (isDiscoveryRunning()) return { queued: false, reason: 'already running' };
  // Discovery runs as an orchestrated workflow: job-discovery agent → fan-out of the opportunity pipeline → skill-gap.
  const { startWorkflow } = await import('./agents/core/orchestrator.js');
  const runId = await startWorkflow(userId, 'discovery', { trigger, sources }, trigger);
  return { queued: true, runId };
}

export async function backupDatabase(): Promise<{ file: string } | { error: string }> {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const file = path.join(config.backupDir, `careerpilot-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  const bin = config.pgBinDir ? path.join(config.pgBinDir, 'pg_dump') : 'pg_dump';
  return new Promise((resolve) => {
    execFile(bin, ['--format=custom', `--file=${file}`, config.databaseUrl], (err) => {
      if (err) return resolve({ error: err.message });
      // Keep the 14 most recent backups.
      const all = fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.dump')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(config.backupDir, old));
      resolve({ file });
    });
  });
}

export async function startScheduler(userId: number) {
  const c = await scheduleDiscovery(userId);
  // Recheck open jobs every 6 hours to detect expired vacancies.
  fixed.push(cron.schedule('30 */6 * * *', () => { recheckStale(userId, 24).catch((e) => console.error('[recheck]', e.message)); }));
  // Refresh exchange rates daily.
  fixed.push(cron.schedule('15 6 * * *', async () => {
    const fx = await fetchFxRates();
    if (fx) await q(`UPDATE search_settings SET fx_rates=$2, fx_updated_at=now() WHERE user_id=$1`, [userId, json(fx)]);
  }));
  // Nightly database backup.
  fixed.push(cron.schedule('0 2 * * *', async () => { const r = await backupDatabase(); console.log('[backup]', r); }));
  console.log(`[scheduler] discovery: ${c ?? 'disabled'}; recheck every 6h; FX daily; backup nightly`);
}
