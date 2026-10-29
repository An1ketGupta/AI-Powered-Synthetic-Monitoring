export type MonitorStatus = "up" | "down" | "degraded";

export interface LiveState {
  status: MonitorStatus;
  consecutiveFailures: number;
  openIncidentId: string | null;
  openIncidentSeverity: "down" | "degraded" | null;
  lastCheckedAt: string | null;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: string;
  expected_status: number;
  interval_seconds: number;
  timeout_ms: number;
  region_quorum: number;
  is_active: number;
  created_at: string;
  live: LiveState;
}

export interface Check {
  id: number;
  monitor_id: string;
  status: MonitorStatus;
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
  /** Null for checks recorded before multi-region probing. */
  regions: RegionCheck[] | null;
}

export interface RegionCheck {
  region: string;
  colo: string | null;
  status: MonitorStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface Incident {
  id: string;
  monitor_id: string;
  status: "open" | "resolved";
  severity: "down" | "degraded";
  started_at: string;
  resolved_at: string | null;
  summary: string | null;
  summary_is_fallback: number;
  resolution_summary: string | null;
  similar_incident_ids: string | null;
  monitor_name?: string;
  monitor_url?: string;
}

export interface MonitorDetail extends Monitor {
  checks: Check[];
  incidents: Incident[];
}

export interface NewMonitorInput {
  name: string;
  url: string;
  method: string;
  expected_status: number;
  interval_seconds: number;
  timeout_ms: number;
  region_quorum: number;
}
