-- Professional evidence base + vacancy freshness + document QA.

CREATE TABLE IF NOT EXISTS evidence_claims (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,      -- experience | project | skill | profile | education
  entity_key    TEXT NOT NULL,      -- stable key, e.g. experience company name or project name
  field         TEXT NOT NULL,      -- title | dates | responsibility | technology | description | contribution | achievement | fact
  value         TEXT NOT NULL,
  source_type   TEXT NOT NULL,      -- portfolio | cv | github | linkedin | user_brief | user_confirmed | conversation
  source_url    TEXT,
  status        TEXT NOT NULL,      -- verified | user_confirmed | indicated | missing | conflicting | rejected
  conflict_group TEXT,              -- claims that contradict each other share a group
  note          TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_entity_idx ON evidence_claims(user_id, entity_type, entity_key);

CREATE TABLE IF NOT EXISTS evidence_sources (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type  TEXT NOT NULL,
  url          TEXT,
  title        TEXT,
  status       TEXT NOT NULL,      -- reviewed | inaccessible | partial
  detail       TEXT,
  reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cv_uploads (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  text        TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Freshness: where the publication date came from, and the reposting-resistant effective date.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at_source TEXT;            -- ats | aggregator | jsonld | none
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;    -- "last updated" from the source if provided
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_published_at TIMESTAMPTZ; -- from the official ATS posting, when found
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS effective_published_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS publication_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS publication_note TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_verified_open_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_repost BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS jobs_effective_pub_idx ON jobs(user_id, effective_published_at DESC);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS qa JSONB;               -- {passed, errors[], warnings[], checkedAt}
ALTER TABLE documents ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
