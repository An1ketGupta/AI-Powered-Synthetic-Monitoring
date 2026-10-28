-- Records whether an incident note came from Workers AI or from the
-- deterministic fallback.
--
-- Added after a mistyped model id made every note silently fall back: the
-- product looked like it was working because incidents still appeared with
-- readable text. Without this flag there is no way to tell a degraded
-- deployment from a healthy one, in the UI or in a query.

ALTER TABLE incidents ADD COLUMN summary_is_fallback INTEGER NOT NULL DEFAULT 0;
