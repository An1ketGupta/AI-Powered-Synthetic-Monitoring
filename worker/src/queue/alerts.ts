import type { AlertMessage } from "../types";

/**
 * Incident notifications go through a Queue rather than being sent inline
 * from the health-check sweep: delivery to an external channel is slow and
 * can fail, and the sweep must not be delayed or retried because a webhook
 * endpoint was down. The Queue owns retries and the dead-letter path.
 */
export async function enqueueAlert(env: Env, message: AlertMessage): Promise<void> {
  await env.ALERT_QUEUE.send(message);
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
