import { describe, it, expect } from "vitest";
import { shanghaiInputToIso } from "./prelaunch-time.js";
describe("labelled Shanghai activity time", () => {
  it("preserves midnight and date across the UTC boundary", () => { expect(shanghaiInputToIso("2026-10-02T00:15")).toBe("2026-10-01T16:15:00.000Z"); });
  it.each(["2026-02-30T12:00", "2026-10-02T24:30", "2026-10-02", "2026-10-02T12:00Z"])("rejects invalid or ambiguous input %s", raw => { expect(() => shanghaiInputToIso(raw)).toThrow(); });
});
