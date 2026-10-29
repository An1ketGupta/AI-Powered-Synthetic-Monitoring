export type MonitorStatus = "up" | "down" | "degraded";
export type IncidentStatus = "open" | "resolved";

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: string;
  expected_status: number;
  interval_seconds: number;
  timeout_ms: number;
  /** How many probe regions must agree a check failed before it counts as a failure. */
  region_quorum: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CheckRecord {
  id: number;
  monitor_id: string;
  status: MonitorStatus;
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
  /** JSON-encoded RegionCheck[]; null for checks recorded before multi-region probing. */
  regions: string | null;
}

export interface Incident {
  id: string;
  monitor_id: string;
  status: IncidentStatus;
  severity: "down" | "degraded";
  started_at: string;
  resolved_at: string | null;
  summary: string | null;
  /** 1 when `summary` came from the deterministic fallback, not Workers AI. */
  summary_is_fallback: number;
  resolution_summary: string | null;
  similar_incident_ids: string | null;
  created_at: string;
  updated_at: string;
}

/** Result of a single edge health-check fetch, before it is handed to the Durable Object. */
export interface CheckResult {
  status: MonitorStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
  /** Per-region breakdown, present when the result aggregates several probe regions. */
  regions?: RegionCheck[];
}

/** One probe region's view of a check, as stored in `checks.regions`. */
export interface RegionCheck {
  region: string;
  /** IATA code of the Cloudflare data center that ran the check, when known. */
  colo: string | null;
  status: MonitorStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** What a RegionProbe returns: a single-region check plus where it ran. */
export type ProbeResult = RegionCheck & { checkedAt: string };

/** Message shape placed on ALERT_QUEUE when an incident opens or resolves. */
export interface AlertMessage {
  kind: "incident_opened" | "incident_resolved";
  incidentId: string;
  monitorId: string;
  monitorName: string;
  monitorUrl: string;
  severity: "down" | "degraded";
  summary: string;
  occurredAt: string;
}
