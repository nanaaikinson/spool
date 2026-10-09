import { describe, it, expect } from "vitest";
import { formatPayload } from "./tasks";
import { searchSchema } from "../app/search";
describe("task inspection", () => {
  it("pretty prints complete JSON and preserves non-JSON, binary and truncated payloads", () => {
    expect(
      formatPayload({
        data: '{"a":1}',
        encoding: "json",
        bytes: 7,
        truncated: false,
      }),
    ).toBe('{\n  "a": 1\n}');
    for (const encoding of ["utf8", "base64"] as const)
      expect(
        formatPayload({
          data: "not-json",
          encoding,
          bytes: 8,
          truncated: false,
        }),
      ).toBe("not-json");
    expect(
      formatPayload({
        data: '{"a":',
        encoding: "json",
        bytes: 999999,
        truncated: true,
      }),
    ).toBe('{"a":');
  });
  it("normalizes invalid URL filters without bypassing generated API types", () => {
    const s = searchSchema.parse({
      state: "invented",
      min_retry: -5,
      range: "forever",
    });
    expect(s.state).toBe("");
    expect(s.min_retry).toBe(0);
    expect(s.range).toBe("1h");
  });
});
