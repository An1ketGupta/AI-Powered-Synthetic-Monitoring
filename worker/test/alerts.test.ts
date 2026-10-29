import { afterEach, describe, expect, it, vi } from "vitest";
import { ALERT_DEAD_LETTER_QUEUE, handleQueueBatch } from "../src/queue/alerts";
import type { AlertMessage } from "../src/types";
import { createFakeEnv } from "./helpers/fake-env";

afterEach(() => {
  vi.restoreAllMocks();
});

const alert: AlertMessage = {
  kind: "incident_opened",
  incidentId: "incident-1",
  monitorId: "m1",
  monitorName: "Example API",
  monitorUrl: "https://api.example.com/health",
  severity: "down",
  summary: "Generated incident note.",
  occurredAt: "2026-01-01T00:00:00.000Z",
};

function makeBatch(queue: string, ids: string[]) {
  const messages = ids.map((id) => ({ id, body: alert, attempts: 1, ack: vi.fn(), retry: vi.fn() }));
  return { batch: { queue, messages } as unknown as MessageBatch<AlertMessage>, messages };
}

describe("handleQueueBatch", () => {
  it("delivers and acks alerts from the main queue", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { env, state } = createFakeEnv([]);
    const { batch, messages } = makeBatch("edgewatch-alerts", ["a", "b"]);

    await handleQueueBatch(batch, env);

    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
    expect(state.failedAlerts.size).toBe(0);
  });

  it("retries a main-queue message whose delivery throws, so the queue can dead-letter it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("transport down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = createFakeEnv([]);
    const { batch, messages } = makeBatch("edgewatch-alerts", ["a"]);

    await handleQueueBatch(batch, env);

    expect(messages[0].retry).toHaveBeenCalledTimes(1);
    expect(messages[0].ack).not.toHaveBeenCalled();
  });

  it("records dead-lettered alerts in D1 instead of delivering them again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { env, state } = createFakeEnv([]);
    const { batch, messages } = makeBatch(ALERT_DEAD_LETTER_QUEUE, ["dead-1"]);

    await handleQueueBatch(batch, env);

    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled(); // not re-delivered
    const row = state.failedAlerts.get("dead-1")!;
    expect(row).toMatchObject({ incident_id: "incident-1", kind: "incident_opened" });
    expect(JSON.parse(row.payload as string)).toEqual(alert);
  });

  it("records a redelivered dead letter only once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, state } = createFakeEnv([]);

    await handleQueueBatch(makeBatch(ALERT_DEAD_LETTER_QUEUE, ["dead-1"]).batch, env);
    await handleQueueBatch(makeBatch(ALERT_DEAD_LETTER_QUEUE, ["dead-1"]).batch, env);

    expect(state.failedAlerts.size).toBe(1);
  });

  it("retries a dead letter when D1 is unavailable rather than acking and losing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = createFakeEnv([]);
    vi.spyOn(env.DB, "prepare").mockImplementation(() => {
      throw new Error("D1 unavailable");
    });
    const { batch, messages } = makeBatch(ALERT_DEAD_LETTER_QUEUE, ["dead-1"]);

    await handleQueueBatch(batch, env);

    expect(messages[0].retry).toHaveBeenCalledTimes(1);
    expect(messages[0].ack).not.toHaveBeenCalled();
  });
});
