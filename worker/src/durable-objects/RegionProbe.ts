import { DurableObject } from "cloudflare:workers";
import { runCheck } from "../lib/check";
import type { Monitor, ProbeResult } from "../types";

/**
 * A fixed vantage point for health checks. There is one instance per probe
 * region (`idFromName(region)`), created with a `locationHint` so it lives
 * in that region, and shared by every monitor -- it holds no per-monitor
 * state, so one instance per region is enough.
 *
 * The hint is honoured when the instance is first created and is
 * best-effort: Cloudflare places the object in or near the region. The colo
 * reported with each result is where the check actually ran, so the record
 * never relies on the hint having been honoured.
 */
export class RegionProbe extends DurableObject<Env> {
  private colo: string | null = null;

  async check(monitor: Monitor, region: string): Promise<ProbeResult> {
    const [result, colo] = await Promise.all([runCheck(monitor), this.getColo()]);
    return { ...result, region, colo };
  }

  /**
   * The colo can't change for the lifetime of an instance, so it's looked up
   * once and cached in memory. A failed lookup isn't cached, so it is retried
   * on the next check instead of being stuck at null.
   */
  private async getColo(): Promise<string | null> {
    if (this.colo) return this.colo;
    try {
      const trace = await (await fetch("https://cloudflare.com/cdn-cgi/trace")).text();
      this.colo = /^colo=(\w+)$/m.exec(trace)?.[1] ?? null;
    } catch (err) {
      console.error("Could not determine probe colo", err);
    }
    return this.colo;
  }
}
