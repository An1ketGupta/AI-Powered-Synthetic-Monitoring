import type { Context, Next } from "hono";

function hasValidToken(c: Context<{ Bindings: Env }>): boolean {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return Boolean(token && c.env.API_TOKEN && token === c.env.API_TOKEN);
}

/** True when this deployment exposes read-only data publicly (demo deployments). */
export function isPublicReadOnly(env: Env): boolean {
  return env.PUBLIC_READ_ONLY === "true";
}

/**
 * EdgeWatch is a single-admin tool, so auth is a single shared bearer token
 * (set with `wrangler secret put API_TOKEN`) rather than a full user/session
 * system. The dashboard asks for it once and stores it in localStorage.
 *
 * When PUBLIC_READ_ONLY is enabled, safe reads are allowed without a token so
 * a deployment can be shared as a live demo. Writes always require the token --
 * monitor creation makes the Worker fetch an arbitrary URL on request, so an
 * unauthenticated write path would be an open request proxy.
 */
export async function requireApiToken(c: Context<{ Bindings: Env }>, next: Next) {
  const isRead = c.req.method === "GET" || c.req.method === "HEAD";

  if (isRead && isPublicReadOnly(c.env)) {
    await next();
    return;
  }

  if (!hasValidToken(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
}
