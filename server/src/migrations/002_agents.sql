-- Multi-agent orchestration: workflow runs, per-agent tasks (execution log), agent outputs.

CREATE TABLE IF NOT EXISTS workflow_runs (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow     TEXT NOT NULL,                 -- vacancy-analysis | application-prep | discovery | profile-refresh
  subject_type TEXT,                          -- job | user
  subject_id   INT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | running | succeeded | partial | failed
  trigger      TEXT NOT NULL DEFAULT 'manual',
  params       JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workflow_runs_pending_idx ON workflow_runs(status, created_at);
CREATE INDEX IF NOT EXISTS workflow_runs_subject_idx ON workflow_runs(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id           SERIAL PRIMARY KEY,
  run_id       INT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step         TEXT NOT NULL,                 -- step id inside the workflow
  agent        TEXT NOT NULL,                 -- agent name, or 'service:<name>'
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | running | succeeded | failed | skipped
  depends_on   JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts     INT NOT NULL DEFAULT 0,
  input        JSONB,
  output       JSONB,
  error        TEXT,
  engine       TEXT,                          -- rules | ai:<provider>:<model> | mixed
  log          JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  duration_ms  INT,
  UNIQUE (run_id, step)
);
CREATE INDEX IF NOT EXISTS agent_tasks_agent_idx ON agent_tasks(agent, status);

-- Output of the JD Extraction Agent (shared record consumed by matching, salary and scoring).
CREATE TABLE IF NOT EXISTS job_extractions (
  job_id      INT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  engine      TEXT NOT NULL,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Output of the Profile Intelligence Agent: suggestions only, never auto-applied.
CREATE TABLE IF NOT EXISTS profile_suggestions (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- skill | project | flag
  payload     JSONB NOT NULL,
  evidence    TEXT,
  source_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | dismissed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS agent TEXT;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS run_id INT;
