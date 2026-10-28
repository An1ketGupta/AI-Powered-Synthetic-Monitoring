import { Hono } from "hono";
import { isPublicReadOnly, requireApiToken } from "./middleware/auth";
import monitorsRoute from "./routes/monitors";
import incidentsRoute from "./routes/incidents";
import { runSweep } from "./scheduled";
import { handleAlertBatch } from "./queue/alerts";
import type { AlertMessage } from "./types";

export { MonitorState } from "./durable-objects/MonitorState";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Lets the dashboard decide whether to show the token gate or a read-only
// view before it has a token to authenticate with.
app.get("/api/config", (c) => c.json({ publicReadOnly: isPublicReadOnly(c.env) }));

app.use("/api/*", requireApiToken);

app.route("/api/monitors", monitorsRoute);
app.route("/api/incidents", incidentsRoute);

/**
 * Runs the health-check sweep on demand, doing exactly what the cron trigger
 * does. Token-gated, since it makes the Worker issue outbound requests.
 *
 * Exists because a newly-deployed Cron Trigger takes up to 15 minutes to
 * propagate across Cloudflare's network, and because a monitoring tool whose
 * only execution path is "wait up to a minute" is painful to demo or debug.
 */
app.post("/api/sweep", async (c) => {
  await runSweep(c.env);
  return c.json({ ok: true, sweptAt: new Date().toISOString() });
});

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json({ error: "Internal server error." }, 500);
});

// `run_worker_first = true` means every request reaches this Worker, so
// anything that isn't an /api/* route gets handed to the static-assets
// binding (the React dashboard), which also resolves the SPA fallback.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => ctx.waitUntil(runSweep(env)),
  queue: handleAlertBatch,
} satisfies ExportedHandler<Env, AlertMessage>;
