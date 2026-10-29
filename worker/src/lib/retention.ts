/**
 * Every monitor writes one `checks` row per check -- ~1,440 a day on a
 * one-minute interval -- so without pruning the table grows forever. A daily
 * cron deletes raw checks older than CHECK_RETENTION_DAYS. Incidents are
 * never pruned: they're the long-term record, and the AI notes already
 * capture the check pattern that mattered.
 *
 * Deletes run in bounded batches. A single unbounded DELETE over a large
 * backlog can exceed D1's per-query time limit, and every deleted row counts
 * toward the daily rows-written allowance (100k/day on the Free plan), so a
 * capped run that catches up over a few days is safer than one big one.
 */
const DELETE_BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 10;

export async function pruneOldChecks(env: Env, now = Date.now()): Promise<number> {
  const retentionDays = Number(env.CHECK_RETENTION_DAYS);
  // A missing or mistyped value must not turn into "delete everything".
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error(`Invalid CHECK_RETENTION_DAYS: ${env.CHECK_RETENTION_DAYS}`);
  }

  const cutoff = new Date(now - retentionDays * 86_400_000).toISOString();
  let deleted = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const { meta } = await env.DB.prepare(
      "DELETE FROM checks WHERE id IN (SELECT id FROM checks WHERE checked_at < ? LIMIT ?)"
    )
      .bind(cutoff, DELETE_BATCH_SIZE)
      .run();

    deleted += meta.changes;
    if (meta.changes < DELETE_BATCH_SIZE) break;
  }

  console.log(JSON.stringify({ event: "checks_pruned", deleted, cutoff }));
  return deleted;
}
