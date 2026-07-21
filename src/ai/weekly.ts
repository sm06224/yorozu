import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ReviewSheet } from "../export/review";

// AI 週次まとめ (設計書 §10-10, #18): 週次レビューの3シートを入力に、
// 中位モデルで所感と来週の一手を生成する。逐次トリアージ (Haiku) より
// 高文脈の判断なので Sonnet を使う。ai_allowed=false のアイテムは
// シート構築の時点で除外されている前提 (呼び出し側の責務)。

export const WEEKLY_MODEL = "claude-sonnet-5";

export const WeeklySummarySchema = z.object({
  summary: z.string(),
  stuck_advice: z.string().nullable(),
  next_step: z.string(),
});
export type WeeklySummary = z.infer<typeof WeeklySummarySchema>;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "今週の所感 (日本語2〜3文。完了の傾向を労いから始める)",
    },
    stuck_advice: {
      type: ["string", "null"],
      description:
        "滞留アイテムへの助言 (最も気になる1件に絞り、具体的な最初の一歩を含める)。滞留が無ければ null",
    },
    next_step: {
      type: "string",
      description: "来週最初にやるべき一手 (日本語1文、具体的に)",
    },
  },
  required: ["summary", "stuck_advice", "next_step"],
  additionalProperties: false,
} as const;

/** シートをプロンプト用の軽量テキストに落とす (行数上限つき) */
export function sheetsToPromptText(
  sheets: readonly ReviewSheet[],
  maxRowsPerSheet = 30,
): string {
  return sheets
    .map((s) => {
      const rows = s.rows
        .slice(0, maxRowsPerSheet)
        .map((r) => `  ${r.map((c) => c ?? "").join(" | ")}`);
      const omitted =
        s.rows.length > maxRowsPerSheet
          ? [`  … 他 ${s.rows.length - maxRowsPerSheet} 件`]
          : [];
      return [`## ${s.name} (${s.rows.length}件)`, ...rows, ...omitted].join(
        "\n",
      );
    })
    .join("\n");
}

export function buildWeeklyPrompt(
  sheets: readonly ReviewSheet[],
  today: string,
): string {
  return [
    `今日は ${today}。以下は個人タスク管理の週次レビュー (直近7日) です。`,
    "ストレスを増やさない週次の振り返りを、指定のスキーマで返してください。",
    "責めない・焦らせない・具体的に、が原則です。",
    "",
    sheetsToPromptText(sheets),
  ].join("\n");
}

export async function suggestWeeklySummary(
  apiKey: string,
  sheets: readonly ReviewSheet[],
  today: string,
): Promise<WeeklySummary> {
  const client = new Anthropic({
    apiKey,
    // BYOK・ブラウザ直叩きは Anthropic が公式に想定する用途 (設計書 §5)
    dangerouslyAllowBrowser: true,
  });
  const response = await client.messages.create({
    model: WEEKLY_MODEL,
    max_tokens: 1024,
    output_config: {
      format: {
        type: "json_schema",
        schema: OUTPUT_SCHEMA,
      },
    },
    messages: [{ role: "user", content: buildWeeklyPrompt(sheets, today) }],
  });
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return WeeklySummarySchema.parse(JSON.parse(text));
}
