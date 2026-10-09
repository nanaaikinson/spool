import { describe, expect, it } from "vitest";
import { clock, relative } from "../lib/time";
describe("clock", () => {
  it("formats elapsed time for ticking displays", () => {
    expect(clock(-500)).toBe("0s");
    expect(clock(9_400)).toBe("9s");
    expect(clock(65_000)).toBe("1m 05s");
    expect(clock(2 * 3600_000 + 3 * 60_000 + 59_000)).toBe("2h 03m");
  });
});
describe("relative", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  it("uses the largest whole unit in either direction", () => {
    expect(relative(now - 2_000, now)).toBe("just now");
    expect(relative(now + 2_000, now)).toBe("now");
    expect(relative(now - 42_000, now)).toBe("42s ago");
    expect(relative(now + 5 * 60_000, now)).toBe("in 5m");
    expect(relative("2026-10-09T09:00:00Z", now)).toBe("3h ago");
    expect(relative(now - 5 * 86_400_000, now)).toBe("5d ago");
  });
});
