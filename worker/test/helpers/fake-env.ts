import { vi } from "vitest";
import type { Monitor, ProbeResult } from "../../src/types";
import { runCheck } from "../../src/lib/check";
import { INITIAL_STATE, applyCheckResult, type MonitorRuntimeState } from "../../src/durable-objects/state-machine";

/**
 * Minimal in-memory stand-ins for the Cloudflare bindings, enough to drive
 * the sweep orchestration. Workers AI and Vectorize bind to real remote
 * resources even in local `wrangler dev`, so these fakes are what let the
 * check -> Durable Object -> D1 -> AI -> Queue pipeline be asserted on in
 * CI without a Cloudflare account.
 */

export interface FakeEnvState {
  monitors: Monitor[];
  incidents: Map<string, Record<string, unknown>>;
  checks: Array<Record<string, unknown>>;
  queued: unknown[];
  failedAlerts: Map<string, Record<string, unknown>>;
  vectors: Map<string, unknown>;
  doStates: Map<string, MonitorRuntimeState>;
  aiCalls: Array<{ model: string; input: unknown }>;
}

export function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: "m1",
    name: "Example API",
    url: "https://api.example.com/health",
    method: "GET",
    expected_status: 200,
    interval_seconds: 60,
    timeout_ms: 10000,
    region_quorum: 3,
    is_active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export interface FakeEnvOptions {
  aiFails?: boolean;
  /**
   * Per-region overrides merged onto a probe's real result. The stubbed
   * global fetch can't tell which region is asking, so this is how a test
   * makes one region see something different from the others.
   */
  probeOverrides?: Record<string, Partial<ProbeResult>>;
  /** Regions whose probe Durable Object itself throws instead of checking. */
  unreachableProbes?: string[];
}

export function createFakeEnv(monitors: Monitor[], options: FakeEnvOptions = {}) {
  const state: FakeEnvState = {
    monitors,
    incidents: new Map(),
    checks: [],
    queued: [],
    failedAlerts: new Map(),
    vectors: new Map(),
    doStates: new Map(),
    aiCalls: [],
  };

  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          return stmt;
        },
        async run() {
          const changes = applyWrite(state, sql, stmt.args);
          return { success: true, meta: { changes } };
        },
        async first<T>() {
          return readFirst(state, sql, stmt.args) as T;
        },
        async all<T>() {
          return { results: readAll(state, sql, stmt.args) as T[] };
        },
      };
      return stmt;
    },
  };

  const env = {
    DB: db,
    CONFIG_CACHE: {
      async get() {
        return null; // force the D1 path so cache misses are exercised
      },
      async put() {},
      async delete() {},
    },
    MONITOR_STATE: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        async getState() {
          return state.doStates.get(id) ?? INITIAL_STATE;
        },
        async process(result: Parameters<typeof applyCheckResult>[1], threshold: number) {
          const current = state.doStates.get(id) ?? INITIAL_STATE;
          const next = applyCheckResult(current, result, {
            consecutiveFailuresForIncident: threshold,
            newIncidentId: () => `incident-${state.incidents.size + 1}`,
          });
          state.doStates.set(id, next.state);
          return { action: next.action, status: next.state.status };
        },
        async reset() {
          state.doStates.delete(id);
        },
      }),
    },
    REGION_PROBE: {
      idFromName: (name: string) => name,
      get: (region: string) => ({
        async check(monitor: Monitor): Promise<ProbeResult> {
          if (options.unreachableProbes?.includes(region)) throw new Error(`probe ${region} unreachable`);
          const result = await runCheck(monitor);
          return { ...result, region, colo: "TST", ...options.probeOverrides?.[region] };
        },
      }),
    },
    AI: {
      async run(model: string, input: unknown) {
        state.aiCalls.push({ model, input });
        if (options.aiFails) throw new Error("AI unavailable");
        if (model.includes("bge")) return { data: [new Array(768).fill(0.01)] };
        return { response: "Generated incident note." };
      },
    },
    INCIDENTS_INDEX: {
      async query() {
        return { matches: [] };
      },
      async upsert(vectors: Array<{ id: string }>) {
        for (const v of vectors) state.vectors.set(v.id, v);
      },
    },
    ALERT_QUEUE: {
      async send(message: unknown) {
        state.queued.push(message);
      },
    },
    CONSECUTIVE_FAILURES_FOR_INCIDENT: "2",
    SIMILAR_INCIDENTS_TOP_K: "3",
    CHECK_RETENTION_DAYS: "30",
  } as unknown as Env;

  return { env, state };
}

/** Returns the number of rows changed, mirroring D1's `meta.changes`. */
function applyWrite(state: FakeEnvState, sql: string, args: unknown[]): number {
  if (sql.includes("DELETE FROM checks")) {
    const [cutoff, limit] = args as [string, number];
    const doomed = new Set(state.checks.filter((c) => (c.checked_at as string) < cutoff).slice(0, limit));
    state.checks = state.checks.filter((c) => !doomed.has(c));
    return doomed.size;
  }

  if (sql.includes("INSERT OR IGNORE INTO failed_alerts")) {
    const [id, incidentId, kind, payload] = args as string[];
    if (state.failedAlerts.has(id)) return 0;
    state.failedAlerts.set(id, { id, incident_id: incidentId, kind, payload });
    return 1;
  }

  if (sql.includes("INSERT INTO checks")) {
    state.checks.unshift({
      id: state.checks.length + 1,
      monitor_id: args[0],
      status: args[1],
      http_status: args[2],
      latency_ms: args[3],
      error: args[4],
      checked_at: args[5],
      regions: args[6],
    });
    return 1;
  }

  if (sql.includes("INSERT INTO incidents")) {
    state.incidents.set(args[0] as string, {
      id: args[0],
      monitor_id: args[1],
      status: "open",
      severity: args[2],
      started_at: args[3],
      resolved_at: null,
      summary: null,
      summary_is_fallback: 0,
      resolution_summary: null,
      similar_incident_ids: null,
    });
    return 1;
  }

  if (sql.includes("UPDATE incidents")) {
    const id = args[args.length - 1] as string;
    const incident = state.incidents.get(id);
    if (!incident) return 0;

    if (sql.includes("SET summary")) {
      incident.summary = args[0];
      incident.summary_is_fallback = args[1];
      incident.similar_incident_ids = args[2];
    } else if (sql.includes("SET resolution_summary")) {
      incident.resolution_summary = args[0];
    } else if (sql.includes("SET status = 'resolved'")) {
      incident.status = "resolved";
      incident.resolved_at = args[0];
    } else if (sql.includes("SET severity")) {
      incident.severity = args[0];
    }
    return 1;
  }

  return 0;
}

function readFirst(state: FakeEnvState, sql: string, args: unknown[]) {
  if (sql.includes("FROM incidents")) return state.incidents.get(args[0] as string) ?? null;
  if (sql.includes("FROM monitors")) return state.monitors.find((m) => m.id === args[0]) ?? null;
  return null;
}

function readAll(state: FakeEnvState, sql: string, args: unknown[]) {
  if (sql.includes("FROM monitors")) return state.monitors.filter((m) => m.is_active === 1);
  if (sql.includes("FROM checks")) return state.checks.filter((c) => c.monitor_id === args[0]);
  if (sql.includes("FROM failed_alerts")) return [...state.failedAlerts.values()];
  return [];
}

/** Stub global fetch so checks resolve deterministically instead of hitting the network. */
export function stubFetch(responder: (url: string) => { status: number } | { throws: Error }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const result = responder(url);
    if ("throws" in result) throw result.throws;
    return new Response(null, { status: result.status });
  });
}
