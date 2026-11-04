-- Manual email composer: full message history on the existing email_log table.
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS kind        TEXT NOT NULL DEFAULT 'system';  -- system | manual
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS to_list     JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS cc          JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS bcc         JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS body_html   TEXT;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS body_text   TEXT;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS client_key  TEXT;          -- one per composed draft: blocks double sends
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS status_checked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS email_log_client_key ON email_log(user_id, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_log_kind_idx ON email_log(user_id, kind, created_at DESC);
