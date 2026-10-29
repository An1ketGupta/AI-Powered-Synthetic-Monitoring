import { Hono } from "hono";

const alerts = new Hono<{ Bindings: Env }>();

/** Alerts that exhausted their queue retries; see src/queue/alerts.ts. */
alerts.get("/failed", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM failed_alerts ORDER BY dead_lettered_at DESC LIMIT ?"
  )
    .bind(limit)
    .all<{ payload: string }>();

  return c.json(results.map((row) => ({ ...row, payload: JSON.parse(row.payload) })));
});

export default alerts;
