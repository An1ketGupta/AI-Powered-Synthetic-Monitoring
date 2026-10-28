-- EdgeWatch initial schema
-- Durable Objects hold the live state machine per monitor; D1 holds the
-- durable record of what's being watched and the historical log used by
-- the dashboard and the "similar past incidents" feature.

CREATE TABLE IF NOT EXISTS monitors (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  method            TEXT NOT NULL DEFAULT 'GET',
  expected_status   INTEGER NOT NULL DEFAULT 200,
  interval_seconds  INTEGER NOT NULL DEFAULT 60,
  timeout_ms        INTEGER NOT NULL DEFAULT 10000,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_monitors_active ON monitors (is_active);

-- One row per completed health check. Pruned/archived independently of the
-- Durable Object's own short-lived in-memory/SQLite window.
CREATE TABLE IF NOT EXISTS checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id    TEXT NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('up', 'down', 'degraded')),
  http_status   INTEGER,
  latency_ms    INTEGER,
  error         TEXT,
  checked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks (monitor_id, checked_at DESC);

-- An incident spans a contiguous period of non-"up" status for a monitor.
-- `summary` / `resolution_summary` are written by Workers AI; `similar_incident_ids`
-- is a JSON array populated from the Vectorize similarity search.
CREATE TABLE IF NOT EXISTS incidents (
  id                      TEXT PRIMARY KEY,
  monitor_id              TEXT NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
  status                  TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  severity                TEXT NOT NULL CHECK (severity IN ('down', 'degraded')),
  started_at              TEXT NOT NULL,
  resolved_at             TEXT,
  summary                 TEXT,
  resolution_summary      TEXT,
  similar_incident_ids    TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents (monitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
