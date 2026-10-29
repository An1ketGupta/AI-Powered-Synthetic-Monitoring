import { describe, expect, it, vi } from "vitest";
import { pruneOldChecks } from "../src/lib/retention";
import { RETENTION_CRON, runScheduled } from "../src/scheduled";
import { createFakeEnv, makeMonitor } from "./helpers/fake-env";

const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function seedChecks(state: ReturnType<typeof createFakeEnv>["state"], ages: number[]) {
  for (const age of ages) {
    state.checks.push({ id: state.checks.length + 1, monitor_id: "m1", status: "up", checked_at: daysAgo(age) });
  }
}

describe("pruneOldChecks", () => {
  it("deletes checks older than the retention window and keeps newer ones", async () => {
    const { env, state } = createFakeEnv([makeMonitor()]);
    seedChecks(state, [1, 29, 31, 45, 90]);

    const deleted = await pruneOldChecks(env, NOW);

    expect(deleted).toBe(3);
    expect(state.checks.map((c) => c.checked_at)).toEqual([daysAgo(1), daysAgo(29)]);
  });

  it("does nothing when every check is inside the window", async () => {
    const { env, state } = createFakeEnv([makeMonitor()]);
    seedChecks(state, [0, 10, 29]);

    expect(await pruneOldChecks(env, NOW)).toBe(0);
    expect(state.checks).toHaveLength(3);
  });

  it("works through a backlog larger than one batch", async () => {
    const { env, state } = createFakeEnv([makeMonitor()]);
    seedChecks(state, new Array(12_000).fill(40));

    expect(await pruneOldChecks(env, NOW)).toBe(12_000);
    expect(state.checks).toHaveLength(0);
  });

  it("caps the work done in a single run so a huge backlog is caught up over several days", async () => {
    const { env, state } = createFakeEnv([makeMonitor()]);
    seedChecks(state, new Array(60_000).fill(40));

    expect(await pruneOldChecks(env, NOW)).toBe(50_000);
    expect(state.checks).toHaveLength(10_000);
  });

  it("refuses to run with an invalid retention setting rather than deleting everything", async () => {
    const { env, state } = createFakeEnv([makeMonitor()]);
    (env as unknown as Record<string, string>).CHECK_RETENTION_DAYS = "";
    seedChecks(state, [1, 40]);

    await expect(pruneOldChecks(env, NOW)).rejects.toThrow(/CHECK_RETENTION_DAYS/);
    expect(state.checks).toHaveLength(2);
  });

  it("runs the pruner on the daily cron and the sweep on every other cron", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor()]);
    seedChecks(state, [400]);

    await runScheduled(RETENTION_CRON, env);
    expect(state.checks).toHaveLength(0); // pruned, and no sweep ran

    await runScheduled("*/1 * * * *", env);
    expect(state.checks).toHaveLength(1); // swept, fresh check recorded
    vi.restoreAllMocks();
  });
});
