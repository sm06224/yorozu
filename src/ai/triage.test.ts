import { describe, expect, test } from "vitest";
import { ItemSchema } from "../core";
import { buildPrompt, TriageSuggestionSchema } from "./triage";

const item = ItemSchema.parse({
  id: "i1",
  space_id: null,
  title: "請求書を払う 8/1まで",
  body: "電気代",
  status: "inbox",
  tags: [],
  ai_allowed: true,
  created_at: "2026-07-20T08:00",
  updated_at: "2026-07-20T08:00",
  triaged_at: null,
  done_at: null,
});

describe("ai/triage", () => {
  test("buildPrompt がアイテム本文と今日の日付を含む", () => {
    const p = buildPrompt(item, "2026-07-20");
    expect(p).toContain("2026-07-20");
    expect(p).toContain("請求書を払う 8/1まで");
    expect(p).toContain("電気代");
  });

  test("buildPrompt は本文が空なら本文行を含まない", () => {
    const p = buildPrompt({ ...item, body: "" }, "2026-07-20");
    expect(p).not.toContain("本文:");
  });

  test("TriageSuggestionSchema が想定レスポンスを受理する", () => {
    const s = TriageSuggestionSchema.parse({
      status: "active",
      due: "2026-08-01",
      reask_days: 0,
      estimated_minutes: 15,
      first_step: "オンラインバンキングを開く",
      reason: "期日が近い支払いのため",
    });
    expect(s.status).toBe("active");
  });

  test("TriageSuggestionSchema が不正値を弾く", () => {
    expect(() =>
      TriageSuggestionSchema.parse({
        status: "inbox",
        due: null,
        reask_days: 5,
        reason: "",
      }),
    ).toThrow();
  });
});
