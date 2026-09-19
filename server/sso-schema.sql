-- Additive migration: existing users, approval state and password hashes are preserved.
CREATE TABLE IF NOT EXISTS sso_clients (
 id text PRIMARY KEY, secret_hash text NOT NULL, redirect_uri text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sso_codes (
 code_hash text PRIMARY KEY,
 session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 client_id text NOT NULL REFERENCES sso_clients(id) ON DELETE CASCADE,
 redirect_uri text NOT NULL, challenge text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS service_sessions (
 token_hash text PRIMARY KEY,
 session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 client_id text NOT NULL REFERENCES sso_clients(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS service_sessions_parent ON service_sessions(session_hash);
CREATE INDEX IF NOT EXISTS sso_codes_parent ON sso_codes(session_hash);

