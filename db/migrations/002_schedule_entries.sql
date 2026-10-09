-- Periodic entries and the tasks they enqueued. Asynq forgets an entry's spec
-- and deletes its enqueue history when the scheduler stops; these keep the link.
CREATE TABLE IF NOT EXISTS schedule_entries (
 entry_id text PRIMARY KEY, spec text NOT NULL, task_type text NOT NULL,
 first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_entries_last_seen ON schedule_entries (last_seen DESC);
CREATE TABLE IF NOT EXISTS schedule_links (
 task_id text NOT NULL, entry_id text NOT NULL REFERENCES schedule_entries (entry_id) ON DELETE CASCADE,
 enqueued_at timestamptz NOT NULL, PRIMARY KEY (task_id, entry_id)
);
CREATE INDEX IF NOT EXISTS schedule_links_enqueued_at ON schedule_links (enqueued_at);
INSERT INTO spool_migrations (version) VALUES (2) ON CONFLICT DO NOTHING;
