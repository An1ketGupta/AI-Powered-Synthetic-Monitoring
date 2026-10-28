import type { CheckResult, Monitor } from "../types";
import type { StateMachineAction } from "../durable-objects/state-machine";

/**
 * Persist the durable consequences of a state-machine decision. Runs in the
 * Worker rather than inside the Durable Object so the DO's hot path stays
 * fast and independent of D1 latency.
 */
export async function persistAction(
  env: Env,
  monitor: Monitor,
  result: CheckResult,
  action: StateMachineAction
): Promise<void> {
  switch (action.type) {
    case "none":
      return;

    case "open_incident":
      await env.DB.prepare(
        `INSERT INTO incidents (id, monitor_id, status, severity, started_at)
         VALUES (?, ?, 'open', ?, ?)`
      )
        .bind(action.incidentId, monitor.id, action.severity, result.checkedAt)
        .run();
      return;

    case "escalate_incident":
      await env.DB.prepare(
        `UPDATE incidents
         SET severity = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
        .bind(action.severity, action.incidentId)
        .run();
      return;

    case "resolve_incident":
      await env.DB.prepare(
        `UPDATE incidents
         SET status = 'resolved', resolved_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
        .bind(result.checkedAt, action.incidentId)
        .run();
      return;
  }
}

/** Recent check history for a monitor, used as context for AI incident summaries. */
export async function recordCheck(env: Env, monitorId: string, result: CheckResult): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO checks (monitor_id, status, http_status, latency_ms, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(monitorId, result.status, result.httpStatus, result.latencyMs, result.error, result.checkedAt)
    .run();
}
