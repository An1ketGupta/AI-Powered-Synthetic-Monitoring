import type { RegionCheck } from "../types";

const REGION_LABELS: Record<string, string> = {
  wnam: "Western North America",
  enam: "Eastern North America",
  weur: "Western Europe",
  apac: "Asia-Pacific",
};

/** One dot per probe region for a single check; hover for where it ran and what it saw. */
export function RegionDots({ regions }: { regions: RegionCheck[] | null }) {
  if (!regions) return <span className="muted">—</span>;

  return (
    <span className="region-dots">
      {regions.map((r) => {
        const where = `${REGION_LABELS[r.region] ?? r.region}${r.colo ? ` (${r.colo})` : ""}`;
        const what = r.error ?? `HTTP ${r.httpStatus} in ${r.latencyMs}ms`;
        return (
          <span key={r.region} className={`region-dot ${r.status}`} title={`${where}: ${what}`}>
            {r.region}
          </span>
        );
      })}
    </span>
  );
}
