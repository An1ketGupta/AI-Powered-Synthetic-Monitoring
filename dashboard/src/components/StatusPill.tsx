import type { MonitorStatus } from "../types";

export function StatusPill({ status, paused }: { status: MonitorStatus; paused?: boolean }) {
  if (paused) return <span className="pill paused">paused</span>;
  return <span className={`pill ${status}`}>{status}</span>;
}
