import { describe, expect, test } from "vitest";
import type { Occurrence } from "../core";
import { occurrencesToIcs } from "./ics";

const occ: Occurrence[] = [
  {
    key: "item1:rule1:2026-07-24T09:00",
    item_id: "item1",
    rule_id: "rule1",
    kind: "deadline",
    at: "2026-07-24T09:00",
    label: "締切まで1日: 請求書を払う",
  },
  {
    key: "item1:rule1:2026-07-25T17:00",
    item_id: "item1",
    rule_id: "rule1",
    kind: "deadline",
    at: "2026-07-25T17:00",
    label: "締切: 請求書を払う",
  },
];

describe("occurrencesToIcs", () => {
  test("スナップショット (決定論)", () => {
    const ics = occurrencesToIcs(occ, "2026-07-20T08:00");
    expect(ics).toMatchInlineSnapshot(`
      "BEGIN:VCALENDAR
      VERSION:2.0
      PRODID:-//yorozu//JP
      CALSCALE:GREGORIAN
      BEGIN:VEVENT
      UID:item1:rule1:2026-07-24T09:00@yorozu
      DTSTAMP:20260720T080000
      DTSTART:20260724T090000
      SUMMARY:締切まで1日: 請求書を払う
      CATEGORIES:DEADLINE
      END:VEVENT
      BEGIN:VEVENT
      UID:item1:rule1:2026-07-25T17:00@yorozu
      DTSTAMP:20260720T080000
      DTSTART:20260725T170000
      SUMMARY:締切: 請求書を払う
      CATEGORIES:DEADLINE
      END:VEVENT
      END:VCALENDAR
      "
    `);
  });

  test("同じ入力から同じ出力 (UID は冪等キー)", () => {
    const a = occurrencesToIcs(occ, "2026-07-20T08:00");
    const b = occurrencesToIcs(occ, "2026-07-20T08:00");
    expect(a).toBe(b);
    expect(a).toContain("UID:item1:rule1:2026-07-24T09:00@yorozu");
  });

  test("特殊文字がエスケープされる", () => {
    const ics = occurrencesToIcs(
      [{ ...(occ[0] as Occurrence), label: "a;b,c\nd" }],
      "2026-07-20T08:00",
    );
    expect(ics).toContain("SUMMARY:a\\;b\\,c\\nd");
  });

  test("75オクテット超の行が折り返される", () => {
    const long = "長いタイトル".repeat(20);
    const ics = occurrencesToIcs(
      [{ ...(occ[0] as Occurrence), label: long }],
      "2026-07-20T08:00",
    );
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
