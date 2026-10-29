import type { AlertMessage } from "../types";

/**
 * Must match `dead_letter_queue` in wrangler.toml. One Worker consumes both
 * queues, and `batch.queue` is how the handler tells them apart.
 */
export const ALERT_DEAD_LETTER_QUEUE = "edgewatch-alerts-dlq";

/**
 * Incident notifications go through a Queue rather than being sent inline
 * from the health-check sweep: delivery to an external channel is slow and
 * can fail, and the sweep must not be delayed or retried because a webhook
 * endpoint was down. The Queue owns retries; a message that still fails
 * after `max_retries` moves to the dead-letter queue.
 */
export async function enqueueAlert(env: Env, message: AlertMessage): Promise<void> {
  await env.ALERT_QUEUE.send(message);
}

export async function handleQueueBatch(batch: MessageBatch<AlertMessage>, env: Env): Promise<void> {
  if (batch.queue === ALERT_DEAD_LETTER_QUEUE) {
    await recordDeadLetters(batch, env);
    return;
  }
  await handleAlertBatch(batch, env);
}

/**
 * Consumer for the alert queue.
 *
 * Delivery is log-only by design: EdgeWatch ships without binding you to a
 * specific notification vendor. `deliver()` below is the single extension
 * point -- adding Slack, a generic webhook, or email means implementing it
 * there, and the retry/batching/DLQ behaviour configured in wrangler.toml
 * applies unchanged.
 */
export async function handleAlertBatch(batch: MessageBatch<AlertMessage>, _env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await deliver(message.body);
      message.ack();
    } catch (err) {
      console.error("Alert delivery failed; will retry", { id: message.id, err });
      message.retry();
    }
  }
}

/**
 * Consumer for the dead-letter queue. Free-plan queue retention is 24 hours,
 * so an alert left sitting in the DLQ would vanish a day later -- exactly the
 * silent loss the DLQ exists to prevent. Each one is copied to D1 instead,
 * where it is listed by GET /api/alerts/failed.
 */
async function recordDeadLetters(batch: MessageBatch<AlertMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO failed_alerts (id, incident_id, kind, payload)
         VALUES (?, ?, ?, ?)`
      )
        .bind(message.id, message.body.incidentId, message.body.kind, JSON.stringify(message.body))
        .run();
      console.error(
        JSON.stringify({ event: "alert_dead_lettered", messageId: message.id, incidentId: message.body.incidentId })
      );
      message.ack();
    } catch (err) {
      console.error("Failed to record dead-lettered alert; will retry", { id: message.id, err });
      message.retry();
    }
  }
}

async function deliver(alert: AlertMessage): Promise<void> {
  // Structured so it's queryable in `wrangler tail` / Workers Logs, and so a
  // real transport can be dropped in without changing the call site.
  console.log(
    JSON.stringify({
      event: alert.kind,
      incidentId: alert.incidentId,
      monitor: { id: alert.monitorId, name: alert.monitorName, url: alert.monitorUrl },
      severity: alert.severity,
      occurredAt: alert.occurredAt,
      summary: alert.summary,
    })
  );
}
