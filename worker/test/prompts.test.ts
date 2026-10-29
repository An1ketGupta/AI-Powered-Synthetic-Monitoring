import { describe, expect, it } from "vitest";
import { buildOpenedPrompt, buildResolvedPrompt } from "../src/ai/prompts";
import type { CheckRecord, Monitor } from "../src/types";

const monitor: Monitor = {
  id: "m1",
  name: "Checkout API",
  url: "https://api.example.com/health",
  method: "GET",
  expected_status: 200,
  interval_seconds: 60,
  timeout_ms: 10000,
  region_quorum: 3,
  is_active: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const check = (overrides: Partial<CheckRecord> = {}): CheckRecord => ({
  id: 1,
  monitor_id: "m1",
  status: "down",
  http_status: 500,
  latency_ms: 120,
  error: "Expected HTTP 200, got 500.",
  checked_at: "2026-01-01T12:00:00.000Z",
  regions: null,
  ...overrides,
});

describe("buildOpenedPrompt", () => {
  it("includes monitor identity and the observed failure detail", () => {
    const { user } = buildOpenedPrompt(monitor, { severity: "down", started_at: "2026-01-01T12:00:00.000Z" }, [check()], []);

    expect(user).toContain("Checkout API");
    expect(user).toContain("GET https://api.example.com/health");
    expect(user).toContain("HTTP 500");
    expect(user).toContain("Expected HTTP 200, got 500.");
  });

  it("omits the prior-incidents section when there are no similar incidents", () => {
    const { user } = buildOpenedPrompt(monitor, { severity: "down", started_at: "2026-01-01T12:00:00.000Z" }, [check()], []);
    expect(user).not.toContain("Prior incidents");
  });

  it("includes similar prior incidents when provided", () => {
    const { user } = buildOpenedPrompt(
      monitor,
      { severity: "down", started_at: "2026-01-01T12:00:00.000Z" },
      [check()],
      [{ id: "i9", startedAt: "2025-12-02T03:00:00.000Z", severity: "down", summary: "Same 500s after a deploy." }]
    );

    expect(user).toContain("Prior incidents");
    expect(user).toContain("Same 500s after a deploy.");
  });

  it("instructs the model not to state a root cause as fact", () => {
    const { system } = buildOpenedPrompt(monitor, { severity: "down", started_at: "2026-01-01T12:00:00.000Z" }, [], []);
    expect(system).toContain("hypothesis");
  });

  it("caps how many checks are sent to keep the prompt bounded", () => {
    const manyChecks = Array.from({ length: 50 }, (_, i) => check({ id: i, latency_ms: i }));
    const { user } = buildOpenedPrompt(monitor, { severity: "down", started_at: "2026-01-01T12:00:00.000Z" }, manyChecks, []);

    const checkLines = user.split("\n").filter((line) => line.startsWith("- 2026-01-01T12:00:00.000Z"));
    expect(checkLines).toHaveLength(12);
  });

  it("handles an empty check history without producing a broken prompt", () => {
    const { user } = buildOpenedPrompt(monitor, { severity: "down", started_at: "2026-01-01T12:00:00.000Z" }, [], []);
    expect(user).toContain("No check history available.");
  });
});

describe("buildResolvedPrompt", () => {
  it("computes the incident duration in minutes", () => {
    const { user } = buildResolvedPrompt(
      monitor,
      {
        severity: "down",
        started_at: "2026-01-01T12:00:00.000Z",
        resolved_at: "2026-01-01T12:04:00.000Z",
        summary: "Returned 500s.",
      },
      [check({ status: "up", http_status: 200, error: null })]
    );

    expect(user).toContain("approximately 4 minute(s)");
    expect(user).toContain("Returned 500s.");
  });

  it("reports a sub-minute outage as one minute rather than zero", () => {
    const { user } = buildResolvedPrompt(
      monitor,
      {
        severity: "down",
        started_at: "2026-01-01T12:00:00.000Z",
        resolved_at: "2026-01-01T12:00:20.000Z",
        summary: null,
      },
      []
    );

    expect(user).toContain("approximately 1 minute(s)");
  });
});
