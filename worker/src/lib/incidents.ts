import type { CheckRecord, CheckResult, Incident, Monitor } from "../types";
import type { StateMachineAction } from "../durable-objects/state-machine";
import { summarizeOpenedIncident, summarizeResolvedIncident } from "../ai/summarize";
import { findSimilarIncidents, indexIncident } from "../ai/similar";
import { enqueueAlert } from "../queue/alerts";

/**
 * Persist the durable consequences of a state-machine decision. Runs in the
 * Worker rather than inside the Durable Object so the DO's hot path stays
 * fast and independent of D1 and Workers AI latency.
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
      await openIncident(env, monitor, result, action.incidentId, action.severity);
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
      await resolveIncident(env, monitor, result, action.incidentId);
      return;
  }
}

async function openIncident(
  env: Env,
  monitor: Monitor,
  result: CheckResult,
  incidentId: string,
  severity: "down" | "degraded"
): Promise<void> {
  // Insert first so the incident is durably recorded even if AI generation
  // fails or the Worker is evicted mid-request; the summary is filled in after.
  await env.DB.prepare(
    `INSERT INTO incidents (id, monitor_id, status, severity, started_at)
     VALUES (?, ?, 'open', ?, ?)`
  )
    .bind(incidentId, monitor.id, severity, result.checkedAt)
    .run();

  const checks = await recentChecks(env, monitor.id);

  // Retrieve similar past incidents first so the generated note can cite the
  // pattern ("same 500s as the Dec 2 incident") rather than describing this
  // failure in isolation.
  const similar = await findSimilarIncidents(env, monitor, severity, checks);

  const summary = await summarizeOpenedIncident(
    env,
    monitor,
    { severity, started_at: result.checkedAt },
    checks,
    similar
  );

  await env.DB.prepare(
    `UPDATE incidents
     SET summary = ?, summary_is_fallback = ?, similar_incident_ids = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  )
    .bind(summary.text, summary.isFallback ? 1 : 0, JSON.stringify(similar.map((s) => s.id)), incidentId)
    .run();

  // Only index notes the model actually wrote. A fallback note is a fixed
  // template, so indexing it would cluster unrelated incidents together purely
  // because their boilerplate matches.
  if (!summary.isFallback) {
    await indexIncident(env, incidentId, monitor, severity, result.checkedAt, summary.text, checks);
  }

  await enqueueAlert(env, {
    kind: "incident_opened",
    incidentId,
    monitorId: monitor.id,
    monitorName: monitor.name,
    monitorUrl: monitor.url,
    severity,
    summary: summary.text,
    occurredAt: result.checkedAt,
  });
}

async function resolveIncident(
  env: Env,
  monitor: Monitor,
  result: CheckResult,
  incidentId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE incidents
     SET status = 'resolved', resolved_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  )
    .bind(result.checkedAt, incidentId)
    .run();

  const incident = await env.DB.prepare("SELECT * FROM incidents WHERE id = ?")
    .bind(incidentId)
    .first<Incident>();
  if (!incident) return;

  const checks = await recentChecks(env, monitor.id);
  const resolutionSummary = await summarizeResolvedIncident(env, monitor, incident, checks);

  await env.DB.prepare(
    `UPDATE incidents SET resolution_summary = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  )
    .bind(resolutionSummary.text, incidentId)
    .run();

  await enqueueAlert(env, {
    kind: "incident_resolved",
    incidentId,
    monitorId: monitor.id,
    monitorName: monitor.name,
    monitorUrl: monitor.url,
    severity: incident.severity,
    summary: resolutionSummary.text,
    occurredAt: result.checkedAt,
  });
}

/** Recent check history for a monitor, used as context for AI incident summaries. */
export async function recentChecks(env: Env, monitorId: string, limit = 12): Promise<CheckRecord[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?"
  )
    .bind(monitorId, limit)
    .all<CheckRecord>();
  return results;
}

export async function recordCheck(env: Env, monitorId: string, result: CheckResult): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO checks (monitor_id, status, http_status, latency_ms, error, checked_at, regions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      monitorId,
      result.status,
      result.httpStatus,
      result.latencyMs,
      result.error,
      result.checkedAt,
      result.regions ? JSON.stringify(result.regions) : null
    )
    .run();
}
