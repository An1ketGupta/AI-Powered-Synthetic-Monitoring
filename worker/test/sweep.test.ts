import { afterEach, describe, expect, it, vi } from "vitest";
import { runSweep } from "../src/scheduled";
import { createFakeEnv, makeMonitor, stubFetch } from "./helpers/fake-env";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSweep", () => {
  it("records a check for a healthy monitor and opens no incident", async () => {
    stubFetch(() => ({ status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);

    expect(state.checks).toHaveLength(1);
    expect(state.checks[0].status).toBe("up");
    expect(state.incidents.size).toBe(0);
    expect(state.queued).toHaveLength(0);
  });

  it("classifies an unexpected status code as down", async () => {
    stubFetch(() => ({ status: 500 }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);

    expect(state.checks[0].status).toBe("down");
    expect(state.checks[0].http_status).toBe(500);
  });

  it("does not open an incident on a single failure", async () => {
    stubFetch(() => ({ status: 500 }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);

    expect(state.incidents.size).toBe(0);
  });

  it("opens an AI-summarized incident and queues an alert after two consecutive failures", async () => {
    stubFetch(() => ({ status: 503 }));
    const { env, state } = createFakeEnv([makeMonitor({ interval_seconds: 60 })]);

    await runSweep(env);
    // Clear lastCheckedAt so the monitor is due again without waiting a minute.
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);

    expect(state.incidents.size).toBe(1);
    const incident = [...state.incidents.values()][0];
    expect(incident.status).toBe("open");
    expect(incident.severity).toBe("down");
    expect(incident.summary).toBe("Generated incident note.");
    expect(incident.summary_is_fallback).toBe(0);

    expect(state.queued).toHaveLength(1);
    expect(state.queued[0]).toMatchObject({ kind: "incident_opened", severity: "down" });
  });

  it("indexes the opened incident into Vectorize for future correlation", async () => {
    stubFetch(() => ({ status: 503 }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);

    expect(state.vectors.size).toBe(1);
    expect(state.aiCalls.some((c) => c.model.includes("bge"))).toBe(true);
  });

  it("still records the incident when Workers AI is unavailable, using the fallback note", async () => {
    stubFetch(() => ({ status: 503 }));
    const { env, state } = createFakeEnv([makeMonitor()], { aiFails: true });

    await runSweep(env);
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);

    expect(state.incidents.size).toBe(1);
    const incident = [...state.incidents.values()][0];
    expect(incident.summary).toContain("Example API");
    expect(incident.summary).not.toBe("Generated incident note.");
  });

  it("flags a fallback note so a degraded deployment is distinguishable", async () => {
    stubFetch(() => ({ status: 503 }));
    const { env, state } = createFakeEnv([makeMonitor()], { aiFails: true });

    await runSweep(env);
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);

    const incident = [...state.incidents.values()][0];
    expect(incident.summary_is_fallback).toBe(1);
  });

  it("does not index a fallback note into Vectorize", async () => {
    // Fallback notes are a fixed template, so indexing them would cluster
    // unrelated incidents together purely because the boilerplate matches.
    stubFetch(() => ({ status: 503 }));
    const { env, state } = createFakeEnv([makeMonitor()], { aiFails: true });

    await runSweep(env);
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);

    expect(state.incidents.size).toBe(1);
    expect(state.vectors.size).toBe(0);
  });

  it("resolves the incident and queues a recovery alert once the monitor is healthy again", async () => {
    let status = 503;
    stubFetch(() => ({ status }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);
    expect(state.incidents.size).toBe(1);

    status = 200;
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);

    const incident = [...state.incidents.values()][0];
    expect(incident.status).toBe("resolved");
    expect(incident.resolved_at).not.toBeNull();
    expect(incident.resolution_summary).toBe("Generated incident note.");
    expect(state.queued.map((q) => (q as { kind: string }).kind)).toEqual([
      "incident_opened",
      "incident_resolved",
    ]);
  });

  it("reports a correct-but-slow response as degraded", async () => {
    // Latency is measured with Date.now(); advance it between request and
    // response so the check looks slow without an actual delay.
    const realNow = Date.now;
    let clock = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      clock += 9000; // 90% of the 10s timeout
      return new Response(null, { status: 200 });
    });

    const { env, state } = createFakeEnv([makeMonitor()]);
    await runSweep(env);

    expect(state.checks[0].status).toBe("degraded");
  });

  it("marks a thrown request as down rather than aborting the sweep", async () => {
    stubFetch(() => ({ throws: new Error("connection refused") }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);

    expect(state.checks[0].status).toBe("down");
    expect(state.checks[0].error).toContain("connection refused");
  });

  it("skips monitors whose interval has not yet elapsed", async () => {
    stubFetch(() => ({ status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor({ interval_seconds: 300 })]);

    await runSweep(env);
    await runSweep(env); // immediately again -- 300s has not passed

    expect(state.checks).toHaveLength(1);
  });

  it("skips inactive monitors entirely", async () => {
    stubFetch(() => ({ status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor({ is_active: 0 })]);

    await runSweep(env);

    expect(state.checks).toHaveLength(0);
  });

  it("checks every due monitor even when one of them fails", async () => {
    stubFetch((url) =>
      url.includes("broken") ? { throws: new Error("boom") } : { status: 200 }
    );
    const { env, state } = createFakeEnv([
      makeMonitor({ id: "m1", url: "https://api.example.com/broken" }),
      makeMonitor({ id: "m2", url: "https://api.example.com/ok" }),
    ]);

    await runSweep(env);

    expect(state.checks).toHaveLength(2);
    expect(state.checks.map((c) => c.monitor_id).sort()).toEqual(["m1", "m2"]);
  });
});
