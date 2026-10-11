-- Spool's own log records, pruned by the store on insert. time is Unix
-- microseconds, so ranges and histogram buckets are integer arithmetic.
CREATE TABLE IF NOT EXISTS logs (
 id integer PRIMARY KEY AUTOINCREMENT, time integer NOT NULL, level text NOT NULL,
 message text NOT NULL, caller text NOT NULL DEFAULT '', attrs text NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS logs_time ON logs (time);
INSERT INTO spool_migrations (version) VALUES (3) ON CONFLICT DO NOTHING;
