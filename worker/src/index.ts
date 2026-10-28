import { Hono } from "hono";
import { requireApiToken } from "./middleware/auth";
import monitorsRoute from "./routes/monitors";
import incidentsRoute from "./routes/incidents";
import { runSweep } from "./scheduled";
import { handleAlertBatch } from "./queue/alerts";
import type { AlertMessage } from "./types";

export { MonitorState } from "./durable-objects/MonitorState";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.use("/api/*", requireApiToken);

app.route("/api/monitors", monitorsRoute);
app.route("/api/incidents", incidentsRoute);

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
