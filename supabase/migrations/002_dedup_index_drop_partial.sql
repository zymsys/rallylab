-- Replace the partial unique index with a non-partial one so PostgREST
-- upsert (`ON CONFLICT (rally_id, section_id, client_event_id)`) can
-- infer the constraint. Postgres rejects partial-index inference unless
-- the INSERT supplies the same predicate, which PostgREST does not.
--
-- Behavior is preserved: NULL client_event_id rows (pre-race events
-- inserted directly) are still non-conflicting because NULLs are
-- distinct in a default-mode unique index.

DROP INDEX IF EXISTS idx_race_day_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_race_day_dedup
  ON domain_events(rally_id, section_id, client_event_id);
