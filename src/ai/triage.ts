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
    reason: { type: "string", description: "提案理由 (日本語で1文)" },
  },
  required: ["status", "due", "reask_days", "reason"],
  additionalProperties: false,
} as const;

export function buildPrompt(item: Item, today: LocalDate): string {
  return [
    `今日は ${today}。以下は個人タスク管理の受信箱に入った1件のメモです。`,
    "このメモをトリアージし、指定のスキーマで提案を返してください。",
    "",
    `題名: ${item.title}`,
    item.body ? `本文: ${item.body}` : "",
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
