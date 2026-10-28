import type { CheckResult, Monitor } from "../types";

/**
 * Latency above this fraction of the monitor's timeout is reported as
 * "degraded" rather than "up": the endpoint answered correctly but is
 * close enough to timing out that it's worth surfacing before it fails.
 */
const DEGRADED_LATENCY_RATIO = 0.5;

/** Perform a single health check from the edge. Never throws. */
export async function runCheck(monitor: Monitor): Promise<CheckResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      signal: AbortSignal.timeout(monitor.timeout_ms),
      redirect: "follow",
      headers: { "User-Agent": "EdgeWatch/1.0 (+synthetic-monitoring)" },
    });

    const latencyMs = Date.now() - startedAt;

    if (response.status !== monitor.expected_status) {
      return {
        status: "down",
        httpStatus: response.status,
        latencyMs,
        error: `Expected HTTP ${monitor.expected_status}, got ${response.status}.`,
        checkedAt,
      };
    }

    const degraded = latencyMs > monitor.timeout_ms * DEGRADED_LATENCY_RATIO;
    return {
      status: degraded ? "degraded" : "up",
      httpStatus: response.status,
      latencyMs,
      error: degraded ? `Slow response: ${latencyMs}ms (timeout is ${monitor.timeout_ms}ms).` : null,
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      status: "down",
      httpStatus: null,
      latencyMs,
      error: isTimeout
        ? `Request timed out after ${monitor.timeout_ms}ms.`
        : `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      checkedAt,
    };
  }
}

/**
 * The cron trigger fires once a minute, but monitors can have longer
 * intervals. A monitor is due when its configured interval has elapsed
 * since the last check (minus a small tolerance, so a monitor on a 300s
 * interval isn't skipped to 360s just because the tick landed a second early).
 */
export function isDue(intervalSeconds: number, lastCheckedAt: string | null, now: number): boolean {
  if (!lastCheckedAt) return true;
  const elapsedSeconds = (now - Date.parse(lastCheckedAt)) / 1000;
  const tolerance = 5;
  return elapsedSeconds >= intervalSeconds - tolerance;
}
