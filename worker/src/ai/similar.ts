import { EMBEDDING_MODEL } from "./models";
import type { SimilarIncidentContext } from "./prompts";
import type { CheckRecord, Monitor } from "../types";

/**
 * Minimum cosine similarity for a past incident to be considered related.
 * Without a floor, Vectorize always returns its top-k nearest neighbours --
 * including unrelated ones when the index is nearly empty -- and the model
 * would then claim a pattern that doesn't exist.
 */
const MIN_SIMILARITY_SCORE = 0.7;

interface IncidentVectorMetadata {
  monitorId: string;
  monitorName: string;
  startedAt: string;
  severity: string;
  summary: string;
}

async function embed(env: Env, text: string): Promise<number[]> {
  const result = (await env.AI.run(EMBEDDING_MODEL, { text: [text] })) as { data: number[][] };
  return result.data[0];
}

/**
 * Describes an incident in the same shape at write time and at query time, so
 * a new failure's embedding lands near past failures that looked like it.
 */
function describeForEmbedding(
  monitor: Monitor,
  severity: string,
  checks: CheckRecord[],
  summary?: string
): string {
  const latest = checks[0];
  const signal = [
    `monitor: ${monitor.name}`,
    `url: ${monitor.url}`,
    `severity: ${severity}`,
    latest?.http_status != null ? `http status: ${latest.http_status}` : null,
    latest?.error ? `error: ${latest.error}` : null,
    summary ? `summary: ${summary}` : null,
  ].filter(Boolean);

  return signal.join("\n");
}

/** Find past incidents on this monitor that resemble the one just opened. */
export async function findSimilarIncidents(
  env: Env,
  monitor: Monitor,
  severity: string,
  checks: CheckRecord[]
): Promise<SimilarIncidentContext[]> {
  try {
    const vector = await embed(env, describeForEmbedding(monitor, severity, checks));

    const matches = await env.INCIDENTS_INDEX.query(vector, {
      topK: Number(env.SIMILAR_INCIDENTS_TOP_K),
      returnMetadata: "all",
      filter: { monitorId: monitor.id },
    });

    return matches.matches
      .filter((m) => m.score >= MIN_SIMILARITY_SCORE && m.metadata)
      .map((m) => {
        const meta = m.metadata as unknown as IncidentVectorMetadata;
        return {
          id: m.id,
          startedAt: meta.startedAt,
          severity: meta.severity,
          summary: meta.summary,
        };
      });
  } catch (err) {
    // Similarity context is an enhancement -- an incident must still open
    // and be summarized if Vectorize is unavailable.
    console.error("Vectorize similar-incident lookup failed", err);
    return [];
  }
}

/** Index a newly-summarized incident so future incidents can match against it. */
export async function indexIncident(
  env: Env,
  incidentId: string,
  monitor: Monitor,
  severity: string,
  startedAt: string,
  summary: string,
  checks: CheckRecord[]
): Promise<void> {
  try {
    const vector = await embed(env, describeForEmbedding(monitor, severity, checks, summary));

    await env.INCIDENTS_INDEX.upsert([
      {
        id: incidentId,
        values: vector,
        metadata: {
          monitorId: monitor.id,
          monitorName: monitor.name,
          startedAt,
          severity,
          summary,
        } satisfies IncidentVectorMetadata,
      },
    ]);
  } catch (err) {
    console.error("Vectorize incident indexing failed", err);
  }
}
