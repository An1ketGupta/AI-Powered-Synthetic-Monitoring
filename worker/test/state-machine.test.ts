import { describe, expect, it } from "vitest";
import { applyCheckResult, INITIAL_STATE, type MonitorRuntimeState } from "../src/durable-objects/state-machine";
import type { CheckResult } from "../src/types";

const check = (status: CheckResult["status"], checkedAt = "2026-01-01T00:00:00.000Z"): CheckResult => ({
  status,
  httpStatus: status === "up" ? 200 : status === "down" ? 500 : 200,
  latencyMs: status === "degraded" ? 4000 : 50,
  error: status === "down" ? "fetch failed" : null,
  checkedAt,
});

const options = { consecutiveFailuresForIncident: 2, newIncidentId: () => "incident-1" };

describe("applyCheckResult", () => {
  it("stays up and takes no action on a healthy check", () => {
    const { state, action } = applyCheckResult(INITIAL_STATE, check("up"), options);
    expect(state.status).toBe("up");
    expect(state.consecutiveFailures).toBe(0);
    expect(action).toEqual({ type: "none" });
  });

  it("debounces a single transient failure instead of opening an incident", () => {
    const { state, action } = applyCheckResult(INITIAL_STATE, check("down"), options);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.openIncidentId).toBeNull();
    expect(state.status).toBe("up"); // publicly-reported status unchanged until threshold
    expect(action).toEqual({ type: "none" });
  });

  it("opens an incident once the consecutive-failure threshold is reached", () => {
    const afterFirst = applyCheckResult(INITIAL_STATE, check("down"), options).state;
    const { state, action } = applyCheckResult(afterFirst, check("down"), options);

    expect(state.status).toBe("down");
    expect(state.openIncidentId).toBe("incident-1");
    expect(action).toEqual({ type: "open_incident", incidentId: "incident-1", severity: "down" });
  });

  it("does not open a second incident while one is already open", () => {
    const down: MonitorRuntimeState = {
      status: "down",
      consecutiveFailures: 2,
      openIncidentId: "incident-1",
      openIncidentSeverity: "down",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    };
    const { state, action } = applyCheckResult(down, check("down"), options);

    expect(state.openIncidentId).toBe("incident-1");
    expect(state.consecutiveFailures).toBe(3);
    expect(action).toEqual({ type: "none" });
  });

  it("escalates a degraded incident to down without opening a new incident", () => {
    const degraded: MonitorRuntimeState = {
      status: "degraded",
      consecutiveFailures: 2,
      openIncidentId: "incident-1",
      openIncidentSeverity: "degraded",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    };
    const { state, action } = applyCheckResult(degraded, check("down"), options);

    expect(state.status).toBe("down");
    expect(state.openIncidentSeverity).toBe("down");
    expect(action).toEqual({ type: "escalate_incident", incidentId: "incident-1", severity: "down" });
  });

  it("resolves an open incident immediately on the first healthy check", () => {
    const down: MonitorRuntimeState = {
      status: "down",
      consecutiveFailures: 5,
      openIncidentId: "incident-1",
      openIncidentSeverity: "down",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    };
    const { state, action } = applyCheckResult(down, check("up"), options);

    expect(state.status).toBe("up");
    expect(state.openIncidentId).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
    expect(action).toEqual({ type: "resolve_incident", incidentId: "incident-1" });
  });

  it("resets the consecutive failure count after a healthy check even with no open incident", () => {
    const flaky: MonitorRuntimeState = { ...INITIAL_STATE, consecutiveFailures: 1 };
    const { state } = applyCheckResult(flaky, check("up"), options);
    expect(state.consecutiveFailures).toBe(0);
  });
});
