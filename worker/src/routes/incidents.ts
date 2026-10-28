import { Hono } from "hono";

const incidents = new Hono<{ Bindings: Env }>();

incidents.get("/", async (c) => {
  const status = c.req.query("status"); // "open" | "resolved" | undefined
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

  const query =
    status === "open" || status === "resolved"
      ? c.env.DB.prepare(
          `SELECT incidents.*, monitors.name AS monitor_name, monitors.url AS monitor_url
           FROM incidents JOIN monitors ON monitors.id = incidents.monitor_id
           WHERE incidents.status = ?
           ORDER BY incidents.started_at DESC LIMIT ?`
        ).bind(status, limit)
      : c.env.DB.prepare(
          `SELECT incidents.*, monitors.name AS monitor_name, monitors.url AS monitor_url
           FROM incidents JOIN monitors ON monitors.id = incidents.monitor_id
           ORDER BY incidents.started_at DESC LIMIT ?`
        ).bind(limit);

  const { results } = await query.all();
  return c.json(results);
});

incidents.get("/:id", async (c) => {
  const id = c.req.param("id");
  const incident = await c.env.DB.prepare(
    `SELECT incidents.*, monitors.name AS monitor_name, monitors.url AS monitor_url
     FROM incidents JOIN monitors ON monitors.id = incidents.monitor_id
     WHERE incidents.id = ?`
  )
    .bind(id)
    .first();

  if (!incident) return c.json({ error: "Incident not found." }, 404);
  return c.json(incident);
});

export default incidents;
