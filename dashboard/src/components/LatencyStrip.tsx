import type { Check } from "../types";

/**
 * Compact latency sparkline. Bars are scaled against the slowest check in
 * the window rather than a fixed ceiling, so the shape stays readable
 * whether the endpoint answers in 20ms or 4s.
 */
export function LatencyStrip({ checks, count = 24 }: { checks: Check[]; count?: number }) {
  const window = checks.slice(0, count).reverse();
  if (window.length === 0) return <span className="muted">no checks yet</span>;

  const max = Math.max(...window.map((c) => c.latency_ms ?? 0), 1);

  return (
    <div className="strip" aria-label="Recent check latency">
      {window.map((check) => (
        <div
          key={check.id}
          className={`bar ${check.status}`}
          style={{ height: `${Math.max(12, ((check.latency_ms ?? 0) / max) * 100)}%` }}
          title={`${check.checked_at} — ${check.status}${
            check.latency_ms !== null ? ` — ${check.latency_ms}ms` : ""
          }`}
        />
      ))}
    </div>
  );
}
