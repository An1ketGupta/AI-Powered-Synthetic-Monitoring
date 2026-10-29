import type { CheckResult, Monitor, ProbeResult, RegionCheck } from "../types";

/**
 * Every check runs from one RegionProbe Durable Object per region, placed
 * with a `locationHint`. A single vantage point can't tell "the origin is
 * down" from "the path between one Cloudflare data center and the origin is
 * broken"; asking several regions and requiring a quorum can.
 */
export const PROBE_REGIONS = ["wnam", "enam", "weur", "apac"] as const satisfies readonly DurableObjectLocationHint[];
export type ProbeRegion = (typeof PROBE_REGIONS)[number];

export const DEFAULT_REGION_QUORUM = 3;

const REGION_LABELS: Record<string, string> = {
  wnam: "Western North America",
  enam: "Eastern North America",
  weur: "Western Europe",
  apac: "Asia-Pacific",
};

export function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region;
}

/**
 * Run the check from every probe region concurrently. A probe that fails to
 * respond (the Durable Object itself, not the monitored URL) is left out
 * rather than counted as a failure: an EdgeWatch infrastructure problem must
 * not be reported as the customer's outage.
 */
export async function checkFromAllRegions(env: Env, monitor: Monitor): Promise<CheckResult> {
  const settled = await Promise.allSettled(
    PROBE_REGIONS.map((region) =>
      env.REGION_PROBE.get(env.REGION_PROBE.idFromName(region), { locationHint: region }).check(monitor, region)
    )
  );

  const results: ProbeResult[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else console.error("Region probe failed", { region: PROBE_REGIONS[i], monitorId: monitor.id, err: outcome.reason });
  });

  return aggregateRegionalResults(results, monitor.region_quorum);
}

/**
 * Collapse per-region results into the single result the state machine sees.
 *
 * - `down` when at least `quorum` regions are down.
 * - `degraded` when at least `quorum` regions are down or slow.
 * - otherwise `up`, even if some regions failed. A failure in fewer than
 *   `quorum` regions is a regional problem: it is recorded in `error` and in
 *   the per-region breakdown, but it never opens an incident.
 *
 * If fewer regions reported than the quorum asks for (some probes were
 * unreachable), the quorum shrinks to "all regions that reported", so lost
 * probes can't stop a real outage from being detected.
 */
export function aggregateRegionalResults(results: ProbeResult[], quorum: number): CheckResult {
  if (results.length === 0) throw new Error("No probe region returned a result.");

  const effectiveQuorum = Math.max(1, Math.min(quorum, results.length));
  const down = results.filter((r) => r.status === "down");
  const failing = results.filter((r) => r.status !== "up");

  const status = down.length >= effectiveQuorum ? "down" : failing.length >= effectiveQuorum ? "degraded" : "up";
  const representative =
    (status === "down" ? down[0] : status === "degraded" ? failing[0] : results.find((r) => r.status === "up")) ??
    results[0];

  return {
    status,
    httpStatus: representative.httpStatus,
    latencyMs: medianLatency(results),
    error: describe(status, representative, failing, results.length),
    checkedAt: results.map((r) => r.checkedAt).sort()[0],
    regions: results.map(({ checkedAt: _checkedAt, ...region }) => region),
  };
}

function describe(
  status: CheckResult["status"],
  representative: ProbeResult,
  failing: ProbeResult[],
  total: number
): string | null {
  if (failing.length === 0) return null;

  const where = failing.map((r) => regionLabel(r.region)).join(", ");
  if (status !== "up") {
    return `${representative.error} Failing from ${failing.length} of ${total} regions: ${where}.`;
  }

  const details = failing.map((r) => `${regionLabel(r.region)} (${shortReason(r)})`).join(", ");
  return `Regional issue: failing from ${details}; healthy from ${total - failing.length} of ${total} regions.`;
}

function shortReason(r: RegionCheck): string {
  if (r.status === "degraded") return `slow, ${r.latencyMs}ms`;
  if (r.httpStatus !== null) return `HTTP ${r.httpStatus}`;
  return r.error?.startsWith("Request timed out") ? "timeout" : "unreachable";
}

function medianLatency(results: ProbeResult[]): number | null {
  const latencies = results.map((r) => r.latencyMs).filter((l): l is number => l !== null).sort((a, b) => a - b);
  if (latencies.length === 0) return null;
  const mid = Math.floor(latencies.length / 2);
  return latencies.length % 2 === 1 ? latencies[mid] : Math.round((latencies[mid - 1] + latencies[mid]) / 2);
}
