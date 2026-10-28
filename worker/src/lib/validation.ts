export class ValidationError extends Error {}

export interface CreateMonitorInput {
  name: string;
  url: string;
  method: string;
  expected_status: number;
  interval_seconds: number;
  timeout_ms: number;
}

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);

/** The cron sweep runs once a minute, so sub-minute intervals are rounded up to 60s. */
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 3600;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;

export function parseCreateMonitorInput(body: unknown): CreateMonitorInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new ValidationError("`name` is required.");

  const url = typeof b.url === "string" ? b.url.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ValidationError("`url` must be a valid absolute URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ValidationError("`url` must use http or https.");
  }

  const method = typeof b.method === "string" ? b.method.toUpperCase() : "GET";
  if (!ALLOWED_METHODS.has(method)) {
    throw new ValidationError(`\`method\` must be one of ${[...ALLOWED_METHODS].join(", ")}.`);
  }

  const expectedStatus = b.expected_status === undefined ? 200 : Number(b.expected_status);
  if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
    throw new ValidationError("`expected_status` must be a valid HTTP status code.");
  }

  const intervalSeconds = clampInt(b.interval_seconds, 60, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS);
  const timeoutMs = clampInt(b.timeout_ms, 10000, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

  return {
    name,
    url: parsedUrl.toString(),
    method,
    expected_status: expectedStatus,
    interval_seconds: intervalSeconds,
    timeout_ms: timeoutMs,
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
