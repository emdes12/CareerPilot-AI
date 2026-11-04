import { json, one, pool, q } from '../../db.js';
import { getAgent } from '../registry.js';
import { runAgent } from './runner.js';

/**
 * Main Orchestrator.
 * Executes workflow DAGs: every step whose dependencies are satisfied runs in parallel.
 * Agents exchange only validated, structured outputs persisted in agent_tasks / domain tables.
 */
export interface StepState { userId: number; runId: number; params: any; results: Record<string, any> }
export interface Step {
  id: string;
  /** Run a registered agent… */
  agent?: string;
  /** …or a deterministic backend service. */
  service?: { name: string; run: (s: StepState) => Promise<any> };
  needs?: { step: string; optional?: boolean }[];
  /** Build the agent's typed input from params + upstream results. */
  input?: (s: StepState) => unknown | Promise<unknown>;
  /** Deterministic persistence of the agent's output into domain tables. */
  persist?: (s: StepState, output: any) => Promise<void>;
  /** Skip this step (status=skipped) when it returns false. */
  when?: (s: StepState) => boolean | Promise<boolean>;
}
export interface Workflow { name: string; description: string; subject: 'job' | 'user'; steps: Step[] }

const WORKFLOWS = new Map<string, Workflow>();
export const registerWorkflow = (w: Workflow) => {
  for (const s of w.steps) {
    if (!!s.agent === !!s.service) throw new Error(`Step ${w.name}.${s.id} must define exactly one of agent/service`);
    if (s.agent && !getAgent(s.agent)) throw new Error(`Step ${w.name}.${s.id} references unknown agent ${s.agent}`);
    for (const n of s.needs ?? []) if (!w.steps.some((x) => x.id === n.step)) throw new Error(`Step ${w.name}.${s.id} depends on unknown step ${n.step}`);
  }
  WORKFLOWS.set(w.name, w);
};
export const listWorkflows = () => [...WORKFLOWS.values()];

/** Queue a workflow run for the background worker. Returns immediately. */
export async function startWorkflow(userId: number, workflow: string, params: any, trigger = 'manual'): Promise<number> {
  const w = WORKFLOWS.get(workflow);
  if (!w) throw new Error(`Unknown workflow ${workflow}`);
  const subjectId = w.subject === 'job' ? Number(params.jobId) : userId;
  // Coalesce: don't queue a duplicate of a run that is already pending/running for the same subject.
  const existing = await one<{ id: number }>(`SELECT id FROM workflow_runs WHERE workflow=$1 AND subject_type=$2 AND subject_id=$3 AND status IN ('pending','running') LIMIT 1`, [workflow, w.subject, subjectId]);
  if (existing) return existing.id;
  const r = await one<{ id: number }>(`INSERT INTO workflow_runs (user_id, workflow, subject_type, subject_id, params, trigger) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [userId, workflow, w.subject, subjectId, json(params), trigger]);
  kickWorker();
  return r!.id;
}

/** Run synchronously (CLI, tests, or when the caller needs the result now). */
export async function runWorkflowNow(userId: number, workflow: string, params: any, trigger = 'manual') {
  const id = await startWorkflow(userId, workflow, params, trigger);
  const claimed = await one(`UPDATE workflow_runs SET status='running', started_at=now() WHERE id=$1 AND status='pending' RETURNING id`, [id]);
  if (claimed) await executeRun(id);
  else await waitForRun(id);
  return getRun(id);
}

async function waitForRun(id: number, timeoutMs = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await one<{ status: string }>('SELECT status FROM workflow_runs WHERE id=$1', [id]);
    if (r && !['pending', 'running'].includes(r.status)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function getRun(id: number) {
  const run = await one('SELECT * FROM workflow_runs WHERE id=$1', [id]);
  const tasks = await q('SELECT id, step, agent, status, depends_on, attempts, engine, error, started_at, finished_at, duration_ms, log, output FROM agent_tasks WHERE run_id=$1 ORDER BY id', [id]);
  return { ...run, tasks };
}

async function executeRun(runId: number) {
  const run = await one('SELECT * FROM workflow_runs WHERE id=$1', [runId]);
  const w = WORKFLOWS.get(run.workflow)!;
  const state: StepState = { userId: run.user_id, runId, params: run.params, results: {} };
  for (const s of w.steps) {
    await q(`INSERT INTO agent_tasks (run_id, step, agent, depends_on) VALUES ($1,$2,$3,$4) ON CONFLICT (run_id, step) DO NOTHING`,
      [runId, s.id, s.agent ?? `service:${s.service!.name}`, json(s.needs ?? [])]);
  }
  const status = new Map<string, 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'>(w.steps.map((s) => [s.id, 'pending']));
  const setTask = (step: string, fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    return q(`UPDATE agent_tasks SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE run_id=$1 AND step=$2`, [runId, step, ...keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null && !(fields[k] instanceof Date) ? json(fields[k]) : fields[k]))]);
  };

  const runStep = async (s: Step) => {
    status.set(s.id, 'running');
    const t0 = Date.now();
    await setTask(s.id, { status: 'running', started_at: new Date() });
    try {
      if (s.when && !(await s.when(state))) {
        status.set(s.id, 'skipped');
        await setTask(s.id, { status: 'skipped', error: 'Condition not met', finished_at: new Date(), duration_ms: Date.now() - t0 });
        return;
      }
      let output: any; let engine = 'service'; let attempts = 1; let log: unknown[] = [];
      const input = s.input ? await s.input(state) : state.params;
      if (s.agent) {
        const def = getAgent(s.agent)!;
        const task = await one<{ id: number }>('SELECT id FROM agent_tasks WHERE run_id=$1 AND step=$2', [runId, s.id]);
        await setTask(s.id, { input });
        const r = await runAgent(def, input, { userId: state.userId, runId, taskId: task?.id ?? null });
        output = r.output; engine = r.engine; attempts = r.attempts; log = [...r.log, { msg: `tools used: ${r.toolsUsed.join(', ') || 'none'}` }];
      } else {
        output = await s.service!.run(state);
      }
      if (s.persist) await s.persist(state, output);
      state.results[s.id] = output;
      status.set(s.id, 'succeeded');
      await setTask(s.id, { status: 'succeeded', output: output ?? null, engine, attempts, log, finished_at: new Date(), duration_ms: Date.now() - t0 });
    } catch (e) {
      status.set(s.id, 'failed');
      await setTask(s.id, { status: 'failed', error: (e as Error).message.slice(0, 2000), log: (e as any).agentLog ?? [], attempts: getAgent(s.agent ?? '')?.retry.attempts ?? 1, finished_at: new Date(), duration_ms: Date.now() - t0 });
    }
  };

  // DAG loop: launch all ready steps in parallel; propagate failures to required dependants.
  for (;;) {
    let progressed = false;
    for (const s of w.steps) {
      if (status.get(s.id) !== 'pending') continue;
      const needs = s.needs ?? [];
      const blocked = needs.find((n) => !n.optional && ['failed', 'skipped'].includes(status.get(n.step)!));
      if (blocked) {
        status.set(s.id, 'skipped'); progressed = true;
        await setTask(s.id, { status: 'skipped', error: `Required step "${blocked.step}" ${status.get(blocked.step)}`, finished_at: new Date() });
      }
    }
    const ready = w.steps.filter((s) => status.get(s.id) === 'pending' && (s.needs ?? []).every((n) => ['succeeded', 'failed', 'skipped'].includes(status.get(n.step)!)));
    if (ready.length) { progressed = true; await Promise.allSettled(ready.map(runStep)); }
    if (!progressed) break;
  }

  const vals = [...status.values()];
  const final = vals.every((v) => v === 'succeeded' || v === 'skipped') ? (vals.includes('skipped') && vals.filter((v) => v === 'succeeded').length === 0 ? 'failed' : 'succeeded') : vals.includes('succeeded') ? 'partial' : 'failed';
  const summary = Object.fromEntries([...status.entries()]);
  await q(`UPDATE workflow_runs SET status=$2, finished_at=now(), summary=$3 WHERE id=$1`, [runId, final, json(summary)]);
}

// ---------------- Background worker (Postgres queue) ----------------
let active = 0; let timer: NodeJS.Timeout | null = null; const MAX_CONCURRENT = 3;
let kick: () => void = () => {};
const kickWorker = () => kick();

export function startWorker() {
  const tick = async () => {
    while (active < MAX_CONCURRENT) {
      const c = await pool.connect();
      let id: number | null = null;
      try {
        const r = await c.query(`UPDATE workflow_runs SET status='running', started_at=now() WHERE id = (
          SELECT id FROM workflow_runs WHERE status='pending' ORDER BY (trigger='manual') DESC, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`);
        id = r.rows[0]?.id ?? null;
      } finally { c.release(); }
      if (!id) break;
      active++;
      executeRun(id).catch(async (e) => { await q(`UPDATE workflow_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [id, (e as Error).message]); })
        .finally(() => { active--; kickWorker(); });
    }
  };
  kick = () => { tick().catch((e) => console.error('[worker]', e.message)); };
  // Recover runs interrupted by a restart.
  q(`UPDATE workflow_runs SET status='pending' WHERE status='running'`).then(() => kick());
  timer = setInterval(kick, 3000);
  console.log('[orchestrator] background worker started');
}
export const stopWorker = () => { if (timer) clearInterval(timer); };
