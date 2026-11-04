-- Application automation, notifications and activity history.

-- Permissions. Everything that sends or submits defaults to OFF; nothing is enabled silently.
CREATE TABLE IF NOT EXISTS automation_settings (
  user_id               INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_apply_enabled    BOOLEAN NOT NULL DEFAULT false,
  auto_apply_min_score  INT NOT NULL DEFAULT 90,
  require_approval      BOOLEAN NOT NULL DEFAULT true,
  allow_email_applications  BOOLEAN NOT NULL DEFAULT false,
  allow_portal_applications BOOLEAN NOT NULL DEFAULT false,
  max_applications_per_day  INT NOT NULL DEFAULT 5,
  excluded_companies    JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded_keywords     JSONB NOT NULL DEFAULT '[]'::jsonb,
  paused                BOOLEAN NOT NULL DEFAULT false,
  notify_email_enabled  BOOLEAN NOT NULL DEFAULT true,
  notify_whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  notification_email    TEXT,
  whatsapp_to           TEXT,
  notify_min_score      INT NOT NULL DEFAULT 50,
  docs_min_score        INT NOT NULL DEFAULT 70,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            TEXT
);

CREATE TABLE IF NOT EXISTS application_attempts (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,          -- email | portal | none
  status        TEXT NOT NULL,          -- submitted | manual_required | blocked | pending_approval | failed | skipped
  reason        TEXT,
  requested_by  TEXT NOT NULL,          -- auto | user
  destination   TEXT,
  recipient     TEXT,
  subject       TEXT,
  body          TEXT,
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider      TEXT,
  provider_message_id TEXT,
  provider_status TEXT,
  provider_response JSONB,
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- every permission/eligibility check evaluated
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_attempts_job_idx ON application_attempts(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        INT REFERENCES jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,          -- opportunity | application_result | digest
  dedupe_key    TEXT NOT NULL,
  channel       TEXT NOT NULL,          -- email | whatsapp
  status        TEXT NOT NULL,          -- sent | failed | not_configured | disabled
  recipient     TEXT,
  subject       TEXT,
  provider_message_id TEXT,
  error         TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One successful notification per (job, kind, channel); failed/not_configured rows don't block a later retry.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_sent_once ON notifications(dedupe_key, channel) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS application_events (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- discovered | analysed | researched | documents_generated | tier_assigned | approval_* | attempt | notification | status_change | manual_action
  message    TEXT NOT NULL,
  actor      TEXT NOT NULL,   -- system | agent:<name> | user
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_events_job_idx ON application_events(job_id, created_at);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'none';  -- none | pending | approved | rejected
ALTER TABLE applications ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS automation_status TEXT;  -- submitted | manual_required | blocked | pending_approval | failed | not_attempted
ALTER TABLE applications ADD COLUMN IF NOT EXISTS handoff_document_id INT REFERENCES documents(id) ON DELETE SET NULL;
