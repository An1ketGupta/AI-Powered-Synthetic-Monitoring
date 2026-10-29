import { getActiveMonitors } from "./lib/config-cache";
import { isDue, runCheck } from "./lib/check";
import { persistAction, recordCheck } from "./lib/incidents";
import { pruneOldChecks } from "./lib/retention";
import type { Monitor } from "./types";

/** Must match the daily entry in wrangler.toml's `crons`; every other tick is a sweep. */
export const RETENTION_CRON = "0 3 * * *";

export async function runScheduled(cron: string, env: Env): Promise<void> {
  if (cron === RETENTION_CRON) {
    await pruneOldChecks(env);
    return;
  }
  await runSweep(env);
}

/**
 * The health-check sweep. Runs every minute via cron trigger, checks each
 * monitor that is due, and feeds the result into that monitor's Durable
 * Object to decide whether an incident opens, escalates, or resolves.
 *
 * Monitors are checked concurrently; one failing monitor must not prevent
 * the rest of the sweep from completing, so each is independently guarded.
 */
export async function runSweep(env: Env): Promise<void> {
  const monitors = await getActiveMonitors(env);
  const now = Date.now();

  const results = await Promise.allSettled(monitors.map((monitor) => checkOne(env, monitor, now)));

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.error(`Sweep completed with ${failures.length}/${monitors.length} monitor failures`, failures);
  }
}

async function checkOne(env: Env, monitor: Monitor, now: number): Promise<void> {
  const stub = env.MONITOR_STATE.get(env.MONITOR_STATE.idFromName(monitor.id));

  const { lastCheckedAt } = await stub.getState();
  if (!isDue(monitor.interval_seconds, lastCheckedAt, now)) return;

  const result = await runCheck(monitor);

  const { action } = await stub.process(result, Number(env.CONSECUTIVE_FAILURES_FOR_INCIDENT));

  await recordCheck(env, monitor.id, result);
  await persistAction(env, monitor, result, action);
}
