import type { CheckResult, MonitorStatus } from "../types";

/**
 * Pure, side-effect-free monitor state machine. The Durable Object wraps this
 * with storage; keeping it pure makes the actual decision logic trivial to
 * unit test without spinning up a Durable Object or any Cloudflare bindings.
 */
export interface MonitorRuntimeState {
  status: MonitorStatus;
  consecutiveFailures: number;
  openIncidentId: string | null;
  openIncidentSeverity: "down" | "degraded" | null;
  lastCheckedAt: string | null;
}

export const INITIAL_STATE: MonitorRuntimeState = {
  status: "up",
  consecutiveFailures: 0,
  openIncidentId: null,
  openIncidentSeverity: null,
  lastCheckedAt: null,
};

export type StateMachineAction =
  | { type: "none" }
  | { type: "open_incident"; incidentId: string; severity: "down" | "degraded" }
  | { type: "escalate_incident"; incidentId: string; severity: "down" }
  | { type: "resolve_incident"; incidentId: string };

export interface ApplyCheckOptions {
  /** Number of consecutive non-"up" checks required before an incident is opened. */
  consecutiveFailuresForIncident: number;
  /** Injected so tests can assert on a deterministic id instead of a random uuid. */
  newIncidentId: () => string;
}

export interface ApplyCheckResult {
  state: MonitorRuntimeState;
  action: StateMachineAction;
}

/**
 * Advance the monitor's state machine by one health-check result.
 *
 * Deliberately debounces: a single failing check does NOT open an incident.
 * Only after `consecutiveFailuresForIncident` consecutive non-"up" results
 * does an incident open. This avoids paging/alerting on a single transient
 * blip (a dropped packet, a cold edge location) while still reacting fast
 * to a genuine outage. A single "up" result immediately resolves an open
 * incident and resets the failure count.
 */
export function applyCheckResult(
  state: MonitorRuntimeState,
  result: CheckResult,
  options: ApplyCheckOptions
): ApplyCheckResult {
  if (result.status === "up") {
    if (state.openIncidentId) {
      return {
        state: {
          status: "up",
          consecutiveFailures: 0,
          openIncidentId: null,
          openIncidentSeverity: null,
          lastCheckedAt: result.checkedAt,
        },
        action: { type: "resolve_incident", incidentId: state.openIncidentId },
      };
    }
    return {
      state: { ...state, status: "up", consecutiveFailures: 0, lastCheckedAt: result.checkedAt },
      action: { type: "none" },
    };
  }

  const consecutiveFailures = state.consecutiveFailures + 1;

  if (state.openIncidentId) {
    const escalating = result.status === "down" && state.openIncidentSeverity === "degraded";
    return {
      state: {
        status: escalating ? "down" : state.status,
        consecutiveFailures,
        openIncidentId: state.openIncidentId,
        openIncidentSeverity: escalating ? "down" : state.openIncidentSeverity,
        lastCheckedAt: result.checkedAt,
      },
      action: escalating
        ? { type: "escalate_incident", incidentId: state.openIncidentId, severity: "down" }
        : { type: "none" },
    };
  }

  if (consecutiveFailures >= options.consecutiveFailuresForIncident) {
    const incidentId = options.newIncidentId();
    return {
      state: {
        status: result.status,
        consecutiveFailures,
        openIncidentId: incidentId,
        openIncidentSeverity: result.status,
        lastCheckedAt: result.checkedAt,
      },
      action: { type: "open_incident", incidentId, severity: result.status },
    };
  }

  // Below the debounce threshold: record the failure but don't change the
  // publicly-reported status or open an incident yet.
  return {
    state: { ...state, consecutiveFailures, lastCheckedAt: result.checkedAt },
    action: { type: "none" },
  };
}
