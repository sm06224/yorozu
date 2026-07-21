import { describe, expect, test } from "vitest";
import type { ReviewSheet } from "../export/review";
import {
  buildWeeklyPrompt,
  sheetsToPromptText,
  WeeklySummarySchema,
} from "./weekly";

const SHEETS: ReviewSheet[] = [
  {
    name: "完了 (7日)",
    header: ["題名", "完了日時", "見積(分)"],
    rows: [["請求書を払う", "2026-07-18T10:00", 15]],
  },
  {
    name: "滞留 (7日以上)",
    header: ["状態", "題名", "最終更新", "経過日数"],
    rows: [["進行", "旅行の計画", "2026-07-05T08:00", 15]],
  },
  { name: "発火実績 (7日)", header: ["日時", "種別", "内容"], rows: [] },
];

describe("AI 週次まとめ", () => {
  test("プロンプトにシート名・件数・行が入る", () => {
    const p = buildWeeklyPrompt(SHEETS, "2026-07-20");
    expect(p).toContain("今日は 2026-07-20");
    expect(p).toContain("## 完了 (7日) (1件)");
    expect(p).toContain("請求書を払う | 2026-07-18T10:00 | 15");
    expect(p).toContain("## 発火実績 (7日) (0件)");
  });

  test("行数上限を超えると省略行が入る", () => {
    const many: ReviewSheet = {
      name: "完了 (7日)",
      header: ["題名"],
      rows: Array.from({ length: 40 }, (_, i) => [`t${i}`]),
    };
    const text = sheetsToPromptText([many], 30);
    expect(text).toContain("… 他 10 件");
    expect(text).not.toContain("t35");
  });

  test("null セルは空文字になる", () => {
    const s: ReviewSheet = {
      name: "完了 (7日)",
      header: ["題名", "見積"],
      rows: [["x", null]],
    };
    expect(sheetsToPromptText([s])).toContain("  x | ");
  });

  test("スキーマ: 応答形が検証される", () => {
    const ok = WeeklySummarySchema.parse({
      summary: "よくやった",
      stuck_advice: null,
      next_step: "月曜にまず旅行の宿を1件調べる",
    });
    expect(ok.stuck_advice).toBeNull();
    expect(() =>
      WeeklySummarySchema.parse({ summary: "x", next_step: "y" }),
    ).toThrow();
  });
});
