import { describe, expect, it } from "vitest";
import { isDue } from "../src/lib/check";

const now = Date.parse("2026-01-01T12:00:00.000Z");
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe("isDue", () => {
  it("is due when the monitor has never been checked", () => {
    expect(isDue(60, null, now)).toBe(true);
  });

  it("is not due when less than the interval has elapsed", () => {
    expect(isDue(300, ago(100), now)).toBe(false);
  });

  it("is due once the interval has elapsed", () => {
    expect(isDue(300, ago(301), now)).toBe(true);
  });

  it("tolerates a tick landing slightly early so intervals don't drift a full tick", () => {
    // A 300s monitor whose last check was 297s ago: strict comparison would
    // skip it and push the real interval out to ~360s.
    expect(isDue(300, ago(297), now)).toBe(true);
  });

  it("does not fire twice within the same minute for a 60s monitor", () => {
    expect(isDue(60, ago(5), now)).toBe(false);
  });
});
