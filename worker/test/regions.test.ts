import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateRegionalResults } from "../src/lib/regions";
import { parseCreateMonitorInput } from "../src/lib/validation";
import { runSweep } from "../src/scheduled";
import type { ProbeResult } from "../src/types";
import { createFakeEnv, makeMonitor, stubFetch } from "./helpers/fake-env";

afterEach(() => {
  vi.restoreAllMocks();
});

const up = (region: string, latencyMs = 100): ProbeResult => ({
  region,
  colo: "TST",
  status: "up",
  httpStatus: 200,
  latencyMs,
  error: null,
  checkedAt: "2026-01-01T00:00:00.000Z",
});
const down = (region: string, httpStatus: number | null = 503): ProbeResult => ({
  ...up(region),
  status: "down",
  httpStatus,
  error: httpStatus === null ? "Request timed out after 10000ms." : `Expected HTTP 200, got ${httpStatus}.`,
});
const slow = (region: string): ProbeResult => ({
  ...up(region, 8000),
  status: "degraded",
  error: "Slow response: 8000ms (timeout is 10000ms).",
});

describe("aggregateRegionalResults", () => {
  it("is up with no error when every region is healthy", () => {
    const result = aggregateRegionalResults([up("wnam"), up("enam"), up("weur"), up("apac")], 3);
    expect(result.status).toBe("up");
    expect(result.error).toBeNull();
    expect(result.regions).toHaveLength(4);
  });

  it("reports a failure in fewer regions than the quorum as a regional issue, not an outage", () => {
    const result = aggregateRegionalResults([up("wnam"), up("enam"), up("weur"), down("apac")], 3);
    expect(result.status).toBe("up");
    expect(result.httpStatus).toBe(200);
    expect(result.error).toBe(
      "Regional issue: failing from Asia-Pacific (HTTP 503); healthy from 3 of 4 regions."
    );
  });

  it("is down once the quorum of regions agree", () => {
    const result = aggregateRegionalResults([up("wnam"), down("enam"), down("weur"), down("apac")], 3);
    expect(result.status).toBe("down");
    expect(result.httpStatus).toBe(503);
    expect(result.error).toBe(
      "Expected HTTP 200, got 503. Failing from 3 of 4 regions: Eastern North America, Western Europe, Asia-Pacific."
    );
  });

  it("respects a per-monitor quorum", () => {
    const results = [up("wnam"), up("enam"), down("weur"), down("apac")];
    expect(aggregateRegionalResults(results, 3).status).toBe("up");
    expect(aggregateRegionalResults(results, 2).status).toBe("down");
  });

  it("is degraded when a quorum is failing but not enough of them are fully down", () => {
    const result = aggregateRegionalResults([up("wnam"), down("enam"), slow("weur"), slow("apac")], 3);
    expect(result.status).toBe("degraded");
  });

  it("names timeouts and slow responses in a regional issue", () => {
    const result = aggregateRegionalResults([up("wnam"), up("enam"), slow("weur"), down("apac", null)], 3);
    expect(result.status).toBe("up");
    expect(result.error).toContain("Western Europe (slow, 8000ms)");
    expect(result.error).toContain("Asia-Pacific (timeout)");
  });

  it("shrinks the quorum to the regions that reported, so lost probes can't hide an outage", () => {
    const result = aggregateRegionalResults([down("wnam"), down("enam")], 3);
    expect(result.status).toBe("down");
  });

  it("uses the median latency so one distant region doesn't skew the number", () => {
    const result = aggregateRegionalResults([up("wnam", 40), up("enam", 60), up("weur", 80), up("apac", 900)], 3);
    expect(result.latencyMs).toBe(70);
  });

  it("drops the per-region timestamp from the stored breakdown", () => {
    const result = aggregateRegionalResults([up("wnam")], 3);
    expect(result.regions?.[0]).toEqual({
      region: "wnam",
      colo: "TST",
      status: "up",
      httpStatus: 200,
      latencyMs: 100,
      error: null,
    });
  });

  it("throws when no region reported, rather than inventing a result", () => {
    expect(() => aggregateRegionalResults([], 3)).toThrow();
  });
});

describe("runSweep across regions", () => {
  async function sweepTwice(env: Parameters<typeof runSweep>[0], state: ReturnType<typeof createFakeEnv>["state"]) {
    await runSweep(env);
    state.doStates.set("m1", { ...state.doStates.get("m1")!, lastCheckedAt: null });
    await runSweep(env);
  }

  it("does not open an incident when only one region sees the failure", async () => {
    stubFetch(() => ({ status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor()], {
      probeOverrides: { apac: { status: "down", httpStatus: 503, error: "Expected HTTP 200, got 503." } },
    });

    await sweepTwice(env, state);

    expect(state.incidents.size).toBe(0);
    expect(state.checks[0].status).toBe("up");
    expect(state.checks[0].error).toContain("Regional issue: failing from Asia-Pacific");
  });

  it("opens an incident when the quorum of regions fail", async () => {
    stubFetch(() => ({ status: 200 }));
    const failing = { status: "down", httpStatus: 503, error: "Expected HTTP 200, got 503." } as const;
    const { env, state } = createFakeEnv([makeMonitor()], {
      probeOverrides: { enam: failing, weur: failing, apac: failing },
    });

    await sweepTwice(env, state);

    expect(state.incidents.size).toBe(1);
    expect(state.queued[0]).toMatchObject({ kind: "incident_opened", severity: "down" });
  });

  it("stores the per-region breakdown, including the colo, on the check row", async () => {
    stubFetch(() => ({ status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor()]);

    await runSweep(env);

    const regions = JSON.parse(state.checks[0].regions as string);
    expect(regions.map((r: { region: string }) => r.region)).toEqual(["wnam", "enam", "weur", "apac"]);
    expect(regions[0].colo).toBe("TST");
  });

  it("keeps checking when a probe is unreachable, and doesn't count it as a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => ({ status: 200 }));
    const { env, state } = createFakeEnv([makeMonitor()], { unreachableProbes: ["apac"] });

    await runSweep(env);

    expect(state.checks[0].status).toBe("up");
    expect(state.checks[0].error).toBeNull();
    expect(JSON.parse(state.checks[0].regions as string)).toHaveLength(3);
  });
});

describe("region_quorum validation", () => {
  const base = { name: "API", url: "https://api.example.com" };

  it("defaults to 3 of 4 regions", () => {
    expect(parseCreateMonitorInput(base).region_quorum).toBe(3);
  });

  it("clamps to the number of probe regions", () => {
    expect(parseCreateMonitorInput({ ...base, region_quorum: 9 }).region_quorum).toBe(4);
    expect(parseCreateMonitorInput({ ...base, region_quorum: 0 }).region_quorum).toBe(1);
  });
});
