-- Multi-region checks. Each check now runs from four probe regions
-- (src/lib/regions.ts) and is reduced to one result by a per-monitor quorum.
--
-- region_quorum: how many regions must report a failure before the check
--   counts as failed. Below that it's recorded as a regional issue and
--   never opens an incident. Existing monitors get the default of 3 of 4.
-- regions: the per-region breakdown (region, colo, status, latency, error)
--   as JSON. Stored on the check row rather than as four extra rows, since
--   every row written counts toward D1's daily write allowance. NULL for
--   checks recorded before this migration.

ALTER TABLE monitors ADD COLUMN region_quorum INTEGER NOT NULL DEFAULT 3;
ALTER TABLE checks ADD COLUMN regions TEXT;
