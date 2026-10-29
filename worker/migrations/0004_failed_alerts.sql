-- Alerts that exhausted their retries on edgewatch-alerts and were moved to
-- the dead-letter queue. Queue retention on the Free plan is 24 hours, so a
-- dead-lettered message left in the queue would silently disappear a day
-- later; the DLQ consumer copies each one here instead.
--
-- No foreign key to incidents: a dead-lettered alert is worth keeping even
-- if its monitor (and so its incident) is later deleted.

CREATE TABLE IF NOT EXISTS failed_alerts (
  id                TEXT PRIMARY KEY,   -- queue message id; makes a redelivered DLQ message idempotent
  incident_id       TEXT NOT NULL,
  kind              TEXT NOT NULL,
  payload           TEXT NOT NULL,      -- the full AlertMessage as JSON, so it can be re-sent as-is
  dead_lettered_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_failed_alerts_time ON failed_alerts (dead_lettered_at DESC);
