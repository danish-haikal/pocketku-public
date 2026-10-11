-- Single-user auth. Secrets and raw session tokens are NEVER stored in D1.
CREATE TABLE IF NOT EXISTS pk_auth_sessions (
  session_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pk_auth_sessions_expires ON pk_auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS pk_auth_attempts (
  subject TEXT PRIMARY KEY,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
