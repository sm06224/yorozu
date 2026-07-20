import { describe, expect, test } from "vitest";
import { buildTestEvent } from "./graph";

describe("buildTestEvent", () => {
  test("翌日9:00-9:15 のイベントを組み立てる (決定論)", () => {
    const e = buildTestEvent("2026-07-20T22:30", "Asia/Tokyo");
    expect(e.start).toEqual({
      dateTime: "2026-07-21T09:00:00",
      timeZone: "Asia/Tokyo",
    });
    expect(e.end).toEqual({
      dateTime: "2026-07-21T09:15:00",
      timeZone: "Asia/Tokyo",
    });
    expect(e.subject).toContain("YOROZU");
    expect(e.body.content).toContain("item_id");
  });

  test("月末をまたぐ", () => {
    const e = buildTestEvent("2026-07-31T08:00", "Asia/Tokyo");
    expect(e.start.dateTime).toBe("2026-08-01T09:00:00");
  });
});
