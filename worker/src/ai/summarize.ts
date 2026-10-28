import { SUMMARY_MODEL } from "./models";
import { buildOpenedPrompt, buildResolvedPrompt, type SimilarIncidentContext } from "./prompts";
import type { CheckRecord, Incident, Monitor } from "../types";

interface TextGenerationResult {
  response?: string;
}

async function generate(env: Env, prompt: { system: string; user: string }): Promise<string> {
  const result = (await env.AI.run(SUMMARY_MODEL, {
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    max_tokens: 220,
    temperature: 0.2,
  })) as TextGenerationResult;

  return (result.response ?? "").trim();
}

/**
 * Generate the incident note shown in the dashboard. A monitoring tool that
 * can't record an incident because the LLM was unavailable would be worse
 * than useless, so a failed generation degrades to a deterministic
 * description rather than propagating.
 */
export async function summarizeOpenedIncident(
  env: Env,
  monitor: Monitor,
  incident: Pick<Incident, "severity" | "started_at">,
  checks: CheckRecord[],
  similar: SimilarIncidentContext[]
): Promise<string> {
  try {
    const summary = await generate(env, buildOpenedPrompt(monitor, incident, checks, similar));
    if (summary) return summary;
  } catch (err) {
    console.error("Workers AI incident summarization failed", err);
  }
  return fallbackOpenedSummary(monitor, incident, checks);
}

export async function summarizeResolvedIncident(
  env: Env,
  monitor: Monitor,
  incident: Pick<Incident, "severity" | "started_at" | "resolved_at" | "summary">,
  checks: CheckRecord[]
): Promise<string> {
  try {
    const summary = await generate(env, buildResolvedPrompt(monitor, incident, checks));
    if (summary) return summary;
  } catch (err) {
    console.error("Workers AI resolution summarization failed", err);
  }
  return `${monitor.name} recovered at ${incident.resolved_at}.`;
}

export function fallbackOpenedSummary(
  monitor: Monitor,
  incident: Pick<Incident, "severity" | "started_at">,
  checks: CheckRecord[]
): string {
  const latest = checks[0];
  const detail = latest?.error ?? `status ${latest?.http_status ?? "unknown"}`;
  return `${monitor.name} (${monitor.url}) went ${incident.severity} at ${incident.started_at}: ${detail}`;
}
