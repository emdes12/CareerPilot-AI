-- Every email attempt, for both sender identities.
CREATE TABLE IF NOT EXISTS email_log (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE CASCADE,
  identity      TEXT NOT NULL,          -- notifications | job_application
  from_name     TEXT,
  from_email    TEXT,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{filename, bytes}]
  status        TEXT NOT NULL,          -- accepted | not_configured | rejected | error | delivered | bounced ...
  provider_id   TEXT,
  error         TEXT,
  job_id        INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_user_idx ON email_log(user_id, created_at DESC);

-- Audit of every automation-permission change (who/when/what).
CREATE TABLE IF NOT EXISTS settings_audit (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changes    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one in-flight or successful submission per job (prevents duplicate applications, even under concurrency).
CREATE UNIQUE INDEX IF NOT EXISTS application_attempts_one_submit ON application_attempts(job_id) WHERE status IN ('submitted','in_progress');
