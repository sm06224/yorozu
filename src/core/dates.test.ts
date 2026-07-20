import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { addDays, atHour, dateOf, diffDays, toLocalDateTime } from "./dates";

describe("dates", () => {
  test("addDays が月境界・年境界を越える", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // うるう年
  });

  test("diffDays", () => {
    expect(diffDays("2026-07-25", "2026-07-20")).toBe(5);
    expect(diffDays("2026-07-20", "2026-07-25")).toBe(-5);
  });

  test("atHour / dateOf / toLocalDateTime", () => {
    expect(atHour("2026-07-20", 9)).toBe("2026-07-20T09:00");
    expect(dateOf("2026-07-20T09:30")).toBe("2026-07-20");
    expect(toLocalDateTime(new Date(Date.UTC(2026, 6, 20, 8, 5)))).toBe(
      "2026-07-20T08:05",
    );
  });

  test("プロパティ: addDays の往復とdiffDaysの整合", () => {
    const dateArb = fc
      .record({
        y: fc.integer({ min: 2020, max: 2035 }),
        m: fc.integer({ min: 1, max: 12 }),
        d: fc.integer({ min: 1, max: 28 }),
      })
      .map(
        ({ y, m, d }) =>
          `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`,
      );
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -1000, max: 1000 }), (d, n) => {
        expect(addDays(addDays(d, n), -n)).toBe(d);
        expect(diffDays(addDays(d, n), d)).toBe(n);
      }),
    );
  });
});
