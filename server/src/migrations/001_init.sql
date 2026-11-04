-- CareerPilot AI — initial schema.
-- Designed for a single user today, with user_id foreign keys so multi-user is possible later.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Master professional profile (source of truth). Structured JSON sections keep editing simple.
CREATE TABLE IF NOT EXISTS profiles (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  full_name    TEXT NOT NULL,
  headline     TEXT,
  location     TEXT,
  email        TEXT,
  phone        TEXT,
  links        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {portfolio, github, linkedin}
  summary      TEXT,
  target_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_level TEXT NOT NULL DEFAULT 'mid',
  availability TEXT,                                   -- notice period; null = unknown
  verification_flags JSONB NOT NULL DEFAULT '[]'::jsonb, -- items the user must confirm
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skills (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,             -- canonical taxonomy key, e.g. "react"
  label         TEXT NOT NULL,             -- display, e.g. "React.js"
  category      TEXT NOT NULL DEFAULT 'other',
  proficiency   TEXT NOT NULL CHECK (proficiency IN ('expert','advanced','intermediate','basic','learning')),
  professional  BOOLEAN NOT NULL DEFAULT false,  -- used in paid employment
  years         NUMERIC(4,1),
  evidence      TEXT,                      -- where it is demonstrated
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS experiences (
  id               SERIAL PRIMARY KEY,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company          TEXT NOT NULL,
  company_url      TEXT,
  title            TEXT NOT NULL,
  start_date       TEXT,                   -- free text 'YYYY-MM' or 'YYYY'; null = needs verification
  end_date         TEXT,                   -- null + is_current
  is_current       BOOLEAN NOT NULL DEFAULT false,
  employment_type  TEXT,
  description      TEXT,
  bullets          JSONB NOT NULL DEFAULT '[]'::jsonb,
  technologies     JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_verification BOOLEAN NOT NULL DEFAULT false,
  verification_note TEXT,
  sort_order       INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  url           TEXT,
  repo_url      TEXT,
  problem       TEXT,
  contribution  TEXT,                      -- the user's personal contribution
  team_context  TEXT,                      -- solo / team; what others built
  technologies  JSONB NOT NULL DEFAULT '[]'::jsonb,
  features      JSONB NOT NULL DEFAULT '[]'::jsonb,
  architecture  TEXT,
  challenges    TEXT,
  evidence      TEXT,
  needs_verification BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS education (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  credential  TEXT,
  period      TEXT,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS search_settings (
  user_id           INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  keywords          JSONB NOT NULL,
  remote_only       BOOLEAN NOT NULL DEFAULT true,
  levels            JSONB NOT NULL,
  employment_types  JSONB NOT NULL,
  min_salary_ngn_monthly BIGINT NOT NULL DEFAULT 500000,
  target_salary_ngn_monthly BIGINT NOT NULL DEFAULT 1000000,
  enabled_sources   JSONB NOT NULL,
  company_boards    JSONB NOT NULL,    -- [{ats:'greenhouse', slug:'gitlab', company:'GitLab'}]
  schedule_cron     TEXT NOT NULL DEFAULT '0 7 * * *',
  schedule_enabled  BOOLEAN NOT NULL DEFAULT true,
  max_age_days      INT NOT NULL DEFAULT 30,
  scoring_weights   JSONB NOT NULL,
  fx_rates          JSONB NOT NULL,    -- NGN per 1 unit of currency (estimates)
  fx_updated_at     TIMESTAMPTZ,
  ai_config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL UNIQUE,
  website       TEXT,
  careers_url   TEXT,
  ats           TEXT,
  ats_slug      TEXT,
  description   TEXT,
  facts         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{fact, source_url, verified}]
  researched_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jobs (
  id                SERIAL PRIMARY KEY,
  user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source            TEXT NOT NULL,
  source_job_id     TEXT,
  source_url        TEXT NOT NULL,
  title             TEXT NOT NULL,
  company_name      TEXT NOT NULL,
  company_id        INT REFERENCES companies(id),
  fingerprint       TEXT NOT NULL,
  duplicate_of      INT REFERENCES jobs(id) ON DELETE SET NULL,
  also_seen_on      JSONB NOT NULL DEFAULT '[]'::jsonb,
  posted_at         TIMESTAMPTZ,
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline          TIMESTAMPTZ,
  description_html  TEXT,
  description_text  TEXT,
  location_raw      TEXT,
  location_restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  employment_type   TEXT,
  seniority         TEXT,
  salary_raw        TEXT,
  salary_min        NUMERIC,
  salary_max        NUMERIC,
  salary_currency   TEXT,
  salary_period     TEXT,                -- year | month | hour
  salary_source     TEXT,                -- 'listing' | 'description' | null
  tags              JSONB NOT NULL DEFAULT '[]'::jsonb,
  apply_url         TEXT,
  apply_email       TEXT,
  ats               TEXT,
  status            TEXT NOT NULL DEFAULT 'active',   -- active | expired | unknown
  last_checked_at   TIMESTAMPTZ,
  last_check_result TEXT,
  repost_count      INT NOT NULL DEFAULT 0,
  raw               JSONB,
  UNIQUE (user_id, source, source_job_id)
);
CREATE INDEX IF NOT EXISTS jobs_fingerprint_idx ON jobs(user_id, fingerprint);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(user_id, status);

CREATE TABLE IF NOT EXISTS job_analyses (
  job_id         INT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  total_score    INT NOT NULL,
  classification TEXT NOT NULL,
  actionable     BOOLEAN NOT NULL,
  breakdown      JSONB NOT NULL,   -- per-category {score, max, reasons[]}
  requirements   JSONB NOT NULL,   -- [{skill,label,importance,match,proficiency,professional,evidence}]
  matched        JSONB NOT NULL,
  partial        JSONB NOT NULL,
  missing        JSONB NOT NULL,
  eligibility    JSONB NOT NULL,   -- {status, confidence, evidence[]}
  salary         JSONB NOT NULL,   -- {status, ngnMonthlyMin, ngnMonthlyMax, note}
  experience     JSONB NOT NULL,
  concerns       JSONB NOT NULL,
  recommendation TEXT NOT NULL,
  rationale      TEXT NOT NULL,
  engine         TEXT NOT NULL DEFAULT 'rules-v1',
  weights        JSONB NOT NULL,
  analysed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_research (
  job_id              INT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  discovered_on       TEXT NOT NULL,
  employer            TEXT NOT NULL,
  company_website     TEXT,
  careers_page        TEXT,
  official_url        TEXT,
  official_url_verified BOOLEAN NOT NULL DEFAULT false,
  ats                 TEXT,
  apply_method        TEXT,       -- ats_form | email | external_link | unknown
  apply_email         TEXT,       -- only when explicitly in the listing
  still_open          BOOLEAN,
  description_matches_official BOOLEAN,
  required_documents  JSONB NOT NULL DEFAULT '[]'::jsonb,
  screening_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadline_text       TEXT,
  steps               JSONB NOT NULL DEFAULT '[]'::jsonb,
  log                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- every check performed, with URL + result
  researched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      INT REFERENCES jobs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- cv | cover_letter | email | answers | intro
  version     INT NOT NULL DEFAULT 1,
  title       TEXT NOT NULL,
  content     JSONB NOT NULL,         -- structured content (editable)
  engine      TEXT NOT NULL,
  warnings    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_job_idx ON documents(job_id, kind);

CREATE TABLE IF NOT EXISTS applications (
  id                SERIAL PRIMARY KEY,
  user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id            INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE UNIQUE,
  status            TEXT NOT NULL DEFAULT 'discovered',
  applied_at        TIMESTAMPTZ,
  cv_document_id    INT REFERENCES documents(id) ON DELETE SET NULL,
  cover_document_id INT REFERENCES documents(id) ON DELETE SET NULL,
  destination       TEXT,
  follow_up_at      TIMESTAMPTZ,
  recruiter         JSONB NOT NULL DEFAULT '{}'::jsonb,
  interviews        JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes             TEXT,
  outcome           TEXT,
  history           JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_runs (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL,         -- manual | schedule | recheck
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running',
  stats        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS source_logs (
  id          SERIAL PRIMARY KEY,
  run_id      INT REFERENCES search_runs(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  status      TEXT NOT NULL,          -- ok | error | skipped
  fetched     INT NOT NULL DEFAULT 0,
  relevant    INT NOT NULL DEFAULT 0,
  inserted    INT NOT NULL DEFAULT 0,
  updated     INT NOT NULL DEFAULT 0,
  duration_ms INT,
  error       TEXT,
  attempts    INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE CASCADE,
  task          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,5) NOT NULL DEFAULT 0,
  ok            BOOLEAN NOT NULL DEFAULT true,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
