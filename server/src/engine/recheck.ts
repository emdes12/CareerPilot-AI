import { one, q } from '../db.js';
import { checkUrl, fetchJson } from '../lib/http.js';
import { analyseJob } from './store.js';

/**
 * Re-verify whether a vacancy is still open. Uses the most authoritative method available:
 *  - ATS jobs: the ATS public API for that exact posting
 *  - Others: the listing URL (404/410, redirect to a search page, or "no longer accepting" text => expired)
 */
export async function recheckJob(userId: number, jobId: number): Promise<{ status: string; result: string }> {
  const job = await one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [jobId, userId]);
  if (!job) throw new Error('Job not found');
  let status = 'active'; let result = '';
  const raw = job.raw ?? {};
  try {
    if (job.source === 'greenhouse') {
      const r = await checkUrl(`https://boards-api.greenhouse.io/v1/boards/${raw.board}/jobs/${raw.id}`);
      status = r.status === 404 ? 'expired' : r.ok ? 'active' : 'unknown';
      result = `Greenhouse API → HTTP ${r.status}`;
    } else if (job.source === 'lever') {
      const r = await checkUrl(`https://api.lever.co/v0/postings/${raw.board}/${raw.id}`);
      status = r.status === 404 ? 'expired' : r.ok ? 'active' : 'unknown';
      result = `Lever API → HTTP ${r.status}`;
    } else if (job.source === 'ashby') {
      const d = await fetchJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(raw.board)}`);
      const found = d.jobs.some((j) => j.id === raw.id);
      status = found ? 'active' : 'expired';
      result = `Ashby board ${found ? 'still lists' : 'no longer lists'} this posting`;
    } else if (job.source === 'workable') {
      const d = await fetchJson<{ jobs: any[] }>(`https://apply.workable.com/api/v1/widget/accounts/${raw.board}`);
      const found = d.jobs.some((j) => j.shortcode === raw.shortcode);
      status = found ? 'active' : 'expired';
      result = `Workable board ${found ? 'still lists' : 'no longer lists'} this posting`;
    } else {
      const r = await checkUrl(job.source_url);
      const closedText = /(no longer (accepting|available)|position (has been )?(filled|closed)|job (has )?expired|this job is closed|job not found)/i.test(r.body.slice(0, 200000));
      if (r.status === 404 || r.status === 410 || closedText) status = 'expired';
      else if (r.ok) status = 'active';
      else status = 'unknown';
      result = `Listing URL → HTTP ${r.status}${closedText ? ' (closed notice on page)' : ''}`;
    }
    if (job.deadline && new Date(job.deadline) < new Date()) { status = 'expired'; result += '; deadline passed'; }
  } catch (e) {
    status = 'unknown'; result = `Check failed: ${(e as Error).message}`;
  }
  // Never flip an active job to expired on an inconclusive check.
  const finalStatus = status === 'unknown' ? job.status : status;
  // last_verified_open_at only moves when a conclusive check says the vacancy is open.
  await q(`UPDATE jobs SET status=$2, last_checked_at=now(), last_check_result=$3, last_verified_open_at=CASE WHEN $4 THEN now() ELSE last_verified_open_at END WHERE id=$1`, [jobId, finalStatus, result, status === 'active']);
  if (finalStatus === 'expired') await q(`UPDATE applications SET status='expired', updated_at=now() WHERE job_id=$1 AND status IN ('discovered','recommended','ready_to_apply','analysing')`, [jobId]);
  if (finalStatus !== job.status) await analyseJob(userId, jobId);
  return { status: finalStatus, result };
}

export async function recheckStale(userId: number, olderThanHours = 24, limit = 150) {
  const rows = await q<{ id: number }>(
    `SELECT j.id FROM jobs j LEFT JOIN job_analyses a ON a.job_id=j.id
     WHERE j.user_id=$1 AND j.status <> 'expired' AND j.duplicate_of IS NULL AND (j.last_checked_at IS NULL OR j.last_checked_at < now() - ($2 || ' hours')::interval)
     ORDER BY a.total_score DESC NULLS LAST LIMIT $3`, [userId, String(olderThanHours), limit]);
  const out = { checked: 0, expired: 0, active: 0, unknown: 0 };
  for (const { id } of rows) {
    const r = await recheckJob(userId, id);
    out.checked++; (out as any)[r.status] = ((out as any)[r.status] ?? 0) + 1;
  }
  return out;
}
