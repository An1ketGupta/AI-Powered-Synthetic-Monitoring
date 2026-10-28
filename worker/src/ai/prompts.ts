import type { CheckRecord, Incident, Monitor } from "../types";

export interface SimilarIncidentContext {
  id: string;
  startedAt: string;
  severity: string;
  summary: string;
}

const SYSTEM_PROMPT = `You are an SRE assistant writing incident notes for a monitoring tool.
Write 2-4 short sentences in plain prose. No markdown, no headings, no bullet points.
State what failed, the observable pattern (status codes, latency, duration), and the most
likely cause. Be explicit that a cause is a hypothesis -- you only have black-box HTTP
check data, so never claim to know the root cause for certain. If prior similar incidents
are provided, mention the pattern briefly. Do not invent details you were not given.`;

function describeChecks(checks: CheckRecord[]): string {
  if (checks.length === 0) return "No check history available.";
  return checks
    .slice(0, 12)
    .map((c) => {
      const parts = [c.checked_at, c.status.toUpperCase()];
      if (c.http_status !== null) parts.push(`HTTP ${c.http_status}`);
      if (c.latency_ms !== null) parts.push(`${c.latency_ms}ms`);
      if (c.error) parts.push(c.error);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

function describeSimilar(similar: SimilarIncidentContext[]): string {
  if (similar.length === 0) return "";
  const lines = similar.map((s) => `- ${s.startedAt} (${s.severity}): ${s.summary}`).join("\n");
  return `\n\nPrior incidents on this monitor that resemble this one:\n${lines}`;
}

export function buildOpenedPrompt(
  monitor: Monitor,
  incident: Pick<Incident, "severity" | "started_at">,
  checks: CheckRecord[],
  similar: SimilarIncidentContext[]
): { system: string; user: string } {
  const user = `A monitor just started failing.

Monitor: ${monitor.name}
URL: ${monitor.method} ${monitor.url}
Expected status: ${monitor.expected_status}
Timeout: ${monitor.timeout_ms}ms
Severity: ${incident.severity}
Incident started: ${incident.started_at}

Recent checks (newest first):
${describeChecks(checks)}${describeSimilar(similar)}

Write the incident note.`;

  return { system: SYSTEM_PROMPT, user };
}

export function buildResolvedPrompt(
  monitor: Monitor,
  incident: Pick<Incident, "severity" | "started_at" | "resolved_at" | "summary">,
  checks: CheckRecord[]
): { system: string; user: string } {
  const durationMinutes =
    incident.resolved_at && incident.started_at
      ? Math.max(1, Math.round((Date.parse(incident.resolved_at) - Date.parse(incident.started_at)) / 60000))
      : null;

  const user = `A monitor has recovered. Write a short resolution note.

Monitor: ${monitor.name}
URL: ${monitor.method} ${monitor.url}
Severity while failing: ${incident.severity}
Started: ${incident.started_at}
Recovered: ${incident.resolved_at}
${durationMinutes !== null ? `Duration: approximately ${durationMinutes} minute(s)` : ""}

${incident.summary ? `Note written when the incident opened:\n${incident.summary}\n` : ""}
Recent checks (newest first):
${describeChecks(checks)}

Write the resolution note.`;

  return { system: SYSTEM_PROMPT, user };
}
