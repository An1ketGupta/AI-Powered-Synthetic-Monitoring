import type { Context, Next } from "hono";

/**
 * EdgeWatch is a single-admin tool, so auth is a single shared bearer
 * token (set with `wrangler secret put API_TOKEN`) rather than a full
 * user/session system. The dashboard asks for it once and stores it in
 * localStorage.
 */
export async function requireApiToken(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token || !c.env.API_TOKEN || token !== c.env.API_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
}
