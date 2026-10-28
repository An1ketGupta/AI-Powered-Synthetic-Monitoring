import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { requireApiToken } from "../src/middleware/auth";

function appWith(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/api/*", requireApiToken);
  app.get("/api/monitors", (c) => c.json({ ok: "read" }));
  app.post("/api/monitors", (c) => c.json({ ok: "write" }));
  app.delete("/api/monitors/:id", (c) => c.json({ ok: "delete" }));

  return (path: string, init?: RequestInit) =>
    app.request(path, init, { API_TOKEN: "secret", ...env } as Env);
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("requireApiToken (private deployment)", () => {
  const request = appWith({ PUBLIC_READ_ONLY: "false" as Env["PUBLIC_READ_ONLY"] });

  it("rejects reads without a token", async () => {
    expect((await request("/api/monitors")).status).toBe(401);
  });

  it("allows reads with the correct token", async () => {
    expect((await request("/api/monitors", bearer("secret"))).status).toBe(200);
  });

  it("rejects a wrong token", async () => {
    expect((await request("/api/monitors", bearer("nope"))).status).toBe(401);
  });
});

describe("requireApiToken (public read-only deployment)", () => {
  const request = appWith({ PUBLIC_READ_ONLY: "true" });

  it("allows unauthenticated reads so the deployment can be shared as a demo", async () => {
    const response = await request("/api/monitors");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "read" });
  });

  it("still rejects unauthenticated writes", async () => {
    // Monitor creation makes the Worker fetch an arbitrary URL, so an open
    // write path would turn the demo into a request proxy.
    expect((await request("/api/monitors", { method: "POST" })).status).toBe(401);
  });

  it("still rejects unauthenticated deletes", async () => {
    expect((await request("/api/monitors/m1", { method: "DELETE" })).status).toBe(401);
  });

  it("allows writes with the correct token", async () => {
    const response = await request("/api/monitors", { method: "POST", ...bearer("secret") });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "write" });
  });
});

describe("requireApiToken when API_TOKEN is unset", () => {
  it("does not treat a missing secret as a wildcard", async () => {
    const request = appWith({ API_TOKEN: "", PUBLIC_READ_ONLY: "false" as Env["PUBLIC_READ_ONLY"] });
    expect((await request("/api/monitors", bearer(""))).status).toBe(401);
    expect((await request("/api/monitors", bearer("anything"))).status).toBe(401);
  });
});
