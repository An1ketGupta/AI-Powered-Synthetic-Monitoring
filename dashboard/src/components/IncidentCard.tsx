import type { Incident } from "../types";
import { StatusPill } from "./StatusPill";
import { formatDateTime, formatDuration } from "../lib/format";

export function IncidentCard({ incident, showMonitor }: { incident: Incident; showMonitor?: boolean }) {
  const similarCount = parseSimilarCount(incident.similar_incident_ids);

  return (
    <div className={`incident ${incident.status} ${incident.severity}`}>
      <div className="incident-head">
        <StatusPill status={incident.severity} />
        <strong>{showMonitor ? (incident.monitor_name ?? "Unknown monitor") : null}</strong>
        <span className="muted">
          {formatDateTime(incident.started_at)}
          {" · "}
          {incident.resolved_at
            ? `resolved after ${formatDuration(incident.started_at, incident.resolved_at)}`
            : "ongoing"}
          {similarCount > 0 && ` · ${similarCount} similar past incident${similarCount === 1 ? "" : "s"}`}
        </span>
      </div>

      {incident.summary && (
        <div className="ai-note">
          <span className="label">
            {incident.summary_is_fallback
              ? "Automated note — Workers AI unavailable"
              : "AI incident note"}
          </span>
          {incident.summary}
        </div>
      )}

      {incident.resolution_summary && (
        <div className="ai-note">
          <span className="label">AI resolution note</span>
          {incident.resolution_summary}
        </div>
      )}
    </div>
  );
}

function parseSimilarCount(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
