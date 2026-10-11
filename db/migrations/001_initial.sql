-- Timestamps are UTC text written by bun ('2006-01-02 15:04:05.999999+00:00'),
-- which sorts and compares chronologically.
CREATE TABLE IF NOT EXISTS spool_migrations (version integer PRIMARY KEY, applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs (
 id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL, queue text NOT NULL,
 task_id text NOT NULL DEFAULT '', status text NOT NULL CHECK (status IN ('pending','succeeded','failed')),
 created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at ON audit_logs (created_at DESC);
CREATE TABLE IF NOT EXISTS saved_views (
 id text PRIMARY KEY, actor text NOT NULL, name text NOT NULL, path text NOT NULL,
 created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_views_actor ON saved_views (actor, created_at DESC);
INSERT INTO spool_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
