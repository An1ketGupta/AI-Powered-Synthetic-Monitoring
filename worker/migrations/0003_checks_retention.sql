-- Supports the daily retention job (src/lib/retention.ts), which deletes
-- checks older than CHECK_RETENTION_DAYS across all monitors. The existing
-- (monitor_id, checked_at) index can't serve a range scan on checked_at
-- alone, so without this every prune would be a full table scan.

CREATE INDEX IF NOT EXISTS idx_checks_time ON checks (checked_at);
