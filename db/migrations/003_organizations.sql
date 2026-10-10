-- Idempotent upgrade; legacy operational rows are adopted on first setup.
CREATE TABLE IF NOT EXISTS organizations (
 id text PRIMARY KEY, name text NOT NULL, connection bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
 disabled boolean NOT NULL DEFAULT false, platform_admin boolean NOT NULL DEFAULT false,
 auth_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
 organization_id text NOT NULL REFERENCES organizations(id),
 user_id text NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
 PRIMARY KEY (organization_id, user_id)
);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS organization_id text NOT NULL DEFAULT '';
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS organization_id text NOT NULL DEFAULT '';
ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS organization_id text NOT NULL DEFAULT '';
ALTER TABLE schedule_links ADD COLUMN IF NOT EXISTS organization_id text NOT NULL DEFAULT '';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM spool_migrations WHERE version = 3) THEN
  ALTER TABLE schedule_links DROP CONSTRAINT schedule_links_entry_id_fkey;
  ALTER TABLE schedule_entries DROP CONSTRAINT schedule_entries_pkey;
  ALTER TABLE schedule_entries ADD PRIMARY KEY (organization_id, entry_id);
  ALTER TABLE schedule_links DROP CONSTRAINT schedule_links_pkey;
  ALTER TABLE schedule_links ADD PRIMARY KEY (organization_id, task_id, entry_id);
  ALTER TABLE schedule_links ADD CONSTRAINT schedule_links_entry_id_fkey
    FOREIGN KEY (organization_id, entry_id) REFERENCES schedule_entries(organization_id, entry_id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS audit_logs_organization ON audit_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_views_organization ON saved_views (organization_id, actor, created_at DESC);
INSERT INTO spool_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
