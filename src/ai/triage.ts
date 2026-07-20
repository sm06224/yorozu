import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Item, LocalDate } from "../core";

// AIトリアージ (設計書 §5): 逐次トリアージは最安級モデル。
// 送信するのは該当アイテムの題名・本文のみ。ai_allowed=false のアイテムは送らない。
// 提案は必ず人間が批准する (AI提案 → 批准ループ)。

export const TRIAGE_MODEL = "claude-haiku-4-5";

export const TriageSuggestionSchema = z.object({
  status: z.enum(["active", "waiting", "someday", "done", "archived"]),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  reask_days: z.union([
    z.literal(0),
    z.literal(7),
    z.literal(30),
    z.literal(90),
  ]),
  estimated_minutes: z.int().positive().nullable(),
  first_step: z.string().nullable(),
  reason: z.string(),
});
export type TriageSuggestion = z.infer<typeof TriageSuggestionSchema>;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["active", "waiting", "someday", "done", "archived"],
      description:
        "active=今やる, waiting=誰か/何かを待つ, someday=いつかやる, done=既に済んでいる, archived=破棄してよい",
    },
    due: {
      type: ["string", "null"],
      description: "期日が読み取れる場合のみ YYYY-MM-DD、なければ null",
    },
    reask_days: {
      type: "integer",
      enum: [0, 7, 30, 90],
      description: "再確認の間隔 (日)。不要なら 0",
    },
    estimated_minutes: {
      type: ["integer", "null"],
      description: "作業時間の見積もり (分)。不明なら null",
    },
    first_step: {
      type: ["string", "null"],
      description:
        "着手の助けになる具体的な最初の一歩 (1文)。自明なタスクなら null",
    },
    reason: { type: "string", description: "提案理由 (日本語で1文)" },
  },
  required: [
    "status",
    "due",
    "reask_days",
    "estimated_minutes",
    "first_step",
    "reason",
  ],
  additionalProperties: false,
} as const;

export interface DueContext {
  due: string | null;
  original_due: string | null;
}

export function buildPrompt(
  item: Item,
  today: LocalDate,
  ctx?: DueContext,
): string {
  return [
    `今日は ${today}。以下は個人タスク管理の受信箱に入った1件のメモです。`,
    "このメモをトリアージし、指定のスキーマで提案を返してください。",
    "作業時間を見積もり (estimated_minutes)、残り時間との比較で優先度を判断してください。",
    "先送りを提案する場合は、単純な繰り返しの先送りをせず、",
    "当初の期限を超えず精神的・スケジュール的に無理のない期日を提案してください。",
    "着手が難しそうな内容なら、具体的な最初の一歩を first_step で助けてください。",
    "判断根拠は reason に含めてください。",
    "",
    `題名: ${item.title}`,
    item.body ? `本文: ${item.body}` : "",
    ctx?.due ? `現在の期日: ${ctx.due}` : "",
    ctx?.original_due ? `当初の期限: ${ctx.original_due}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function suggestTriage(
  apiKey: string,
  item: Item,
  today: LocalDate,
): Promise<TriageSuggestion> {
  if (!item.ai_allowed) {
    throw new Error("このアイテムは「AIに送らない」設定です");
  }
  const client = new Anthropic({
    apiKey,
    // BYOK・ブラウザ直叩きは Anthropic が公式に想定する用途 (設計書 §5)
    dangerouslyAllowBrowser: true,
  });
  const response = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 512,
    output_config: {
      format: {
        type: "json_schema",
        schema: OUTPUT_SCHEMA,
      },
    },
    messages: [{ role: "user", content: buildPrompt(item, today) }],
  });
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return TriageSuggestionSchema.parse(JSON.parse(text));
}
