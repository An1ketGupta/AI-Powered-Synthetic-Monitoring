import { SUMMARY_MODEL } from "./models";
import { buildOpenedPrompt, buildResolvedPrompt, type SimilarIncidentContext } from "./prompts";
import type { CheckRecord, Incident, Monitor } from "../types";

interface TextGenerationResult {
  response?: string;
}

/**
 * A generated note, plus whether it actually came from the model. Callers
 * persist `isFallback` so a degraded deployment is visible instead of looking
 * identical to a healthy one.
 */
export interface GeneratedNote {
  text: string;
  isFallback: boolean;
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
): Promise<GeneratedNote> {
  try {
    const summary = await generate(env, buildOpenedPrompt(monitor, incident, checks, similar));
    if (summary) return { text: summary, isFallback: false };
    console.error("Workers AI returned an empty incident summary", { model: SUMMARY_MODEL });
  } catch (err) {
    console.error("Workers AI incident summarization failed", { model: SUMMARY_MODEL, err });
  }
  return { text: fallbackOpenedSummary(monitor, incident, checks), isFallback: true };
}

export async function summarizeResolvedIncident(
  env: Env,
  monitor: Monitor,
  incident: Pick<Incident, "severity" | "started_at" | "resolved_at" | "summary">,
  checks: CheckRecord[]
): Promise<GeneratedNote> {
  try {
    const summary = await generate(env, buildResolvedPrompt(monitor, incident, checks));
    if (summary) return { text: summary, isFallback: false };
    console.error("Workers AI returned an empty resolution summary", { model: SUMMARY_MODEL });
  } catch (err) {
    console.error("Workers AI resolution summarization failed", { model: SUMMARY_MODEL, err });
  }
  return { text: `${monitor.name} recovered at ${incident.resolved_at}.`, isFallback: true };
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
