import { Hono } from "hono";
import type { CheckRecord, Incident, Monitor } from "../types";
import { ValidationError, parseCreateMonitorInput } from "../lib/validation";
import { invalidateActiveMonitorsCache } from "../lib/config-cache";
import type { MonitorRuntimeState } from "../durable-objects/state-machine";

const monitors = new Hono<{ Bindings: Env }>();

function stubFor(env: Env, monitorId: string) {
  return env.MONITOR_STATE.get(env.MONITOR_STATE.idFromName(monitorId));
}

monitors.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM monitors ORDER BY created_at DESC").all<Monitor>();

  const withLiveState = await Promise.all(
    results.map(async (monitor) => {
      const state: MonitorRuntimeState = await stubFor(c.env, monitor.id).getState();
      return { ...monitor, live: state };
    })
  );

  return c.json(withLiveState);
});

monitors.post("/", async (c) => {
  let input;
  try {
    input = parseCreateMonitorInput(await c.req.json());
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO monitors (id, name, url, method, expected_status, interval_seconds, timeout_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.name, input.url, input.method, input.expected_status, input.interval_seconds, input.timeout_ms)
    .run();

  await invalidateActiveMonitorsCache(c.env);

  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first<Monitor>();
  return c.json(monitor, 201);
});

monitors.get("/:id", async (c) => {
  const id = c.req.param("id");

  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first<Monitor>();
  if (!monitor) return c.json({ error: "Monitor not found." }, 404);

  const [{ results: checks }, { results: incidents }, live] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100")
      .bind(id)
      .all<CheckRecord>(),
    c.env.DB.prepare("SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 25")
      .bind(id)
      .all<Incident>(),
    stubFor(c.env, id).getState(),
  ]);

  return c.json({ ...monitor, live, checks, incidents });
});

monitors.put("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first<Monitor>();
  if (!existing) return c.json({ error: "Monitor not found." }, 404);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  let input;
  try {
    input = parseCreateMonitorInput({ ...existing, ...body });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }

  const isActive = typeof body.is_active === "boolean" ? (body.is_active ? 1 : 0) : existing.is_active;

  await c.env.DB.prepare(
    `UPDATE monitors
     SET name = ?, url = ?, method = ?, expected_status = ?, interval_seconds = ?, timeout_ms = ?,
         is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  )
    .bind(input.name, input.url, input.method, input.expected_status, input.interval_seconds, input.timeout_ms, isActive, id)
    .run();

  await invalidateActiveMonitorsCache(c.env);

  const updated = await c.env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first<Monitor>();
  return c.json(updated);
});

monitors.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM monitors WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Monitor not found." }, 404);

  await c.env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id).run();
  await stubFor(c.env, id).reset();
  await invalidateActiveMonitorsCache(c.env);

  return c.body(null, 204);
});

export default monitors;
