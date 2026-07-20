import { z } from "zod";

// 命名メモ: 永続化スキーマは snake_case (journal/snapshot にそのまま載るため)。

export const ITEM_STATUSES = [
  "inbox",
  "active",
  "waiting",
  "someday",
  "done",
  "archived",
] as const;

export const ItemStatusSchema = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

// 日付・日時はタイムゾーン情報を持たないローカル表記の文字列で持つ。
// ISO 形式なので辞書順比較 = 時系列比較が成立し、コアは決定論を保てる。
// タイムゾーンの解釈は PIM/ICS アダプタの境界で行う。
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式");
export const LocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "YYYY-MM-DDTHH:mm 形式");

export type LocalDate = z.infer<typeof LocalDateSchema>;
export type LocalDateTime = z.infer<typeof LocalDateTimeSchema>;

export const ItemSchema = z.object({
  id: z.string().min(1),
  // v0.2 (共有スペース) は棚上げ。列は残す (設計書 v0.3 冒頭)。
  space_id: z.string().nullable(),
  title: z.string().min(1).max(500),
  body: z.string().max(100_000),
  status: ItemStatusSchema,
  tags: z.array(z.string().min(1)),
  // false = このアイテムを AI に送らない (v0.1 §7)
  ai_allowed: z.boolean(),
  created_at: LocalDateTimeSchema,
  // LWW の勝敗キー (設計書 §3)
  updated_at: LocalDateTimeSchema,
  triaged_at: LocalDateTimeSchema.nullable(),
  done_at: LocalDateTimeSchema.nullable(),
});
export type Item = z.infer<typeof ItemSchema>;

export const RULE_KINDS = ["deadline", "reask", "window", "brief"] as const;
export const RuleKindSchema = z.enum(RULE_KINDS);
export type RuleKind = z.infer<typeof RuleKindSchema>;

const ruleBase = {
  id: z.string().min(1),
  item_id: z.string().min(1),
  enabled: z.boolean(),
  created_at: LocalDateTimeSchema,
  updated_at: LocalDateTimeSchema,
};

// deadline: 期日 + リード日数 (例 [7,1,0] = 7日前・前日・当日) に発火
export const DeadlineRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("deadline"),
  due: LocalDateTimeSchema,
  /** 最初に設定した期限。期日を動かしても保持し、先送り判断の基準にする */
  original_due: LocalDateTimeSchema.nullable().default(null),
  lead_days: z.array(z.int().nonnegative()).min(1),
});

// reask: anchor から interval_days ごとに「まだ要る?」を再確認
export const ReaskRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("reask"),
  anchor: LocalDateSchema,
  interval_days: z.int().positive(),
});

// window: 開始日に浮上し、終了前日にクローズ確認
export const WindowRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("window"),
  start: LocalDateSchema,
  end: LocalDateSchema,
});

// brief: 毎朝のブリーフに常設ピン留め
export const BriefRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("brief"),
});

export const SurfaceRuleSchema = z.discriminatedUnion("kind", [
  DeadlineRuleSchema,
  ReaskRuleSchema,
  WindowRuleSchema,
  BriefRuleSchema,
]);
export type SurfaceRule = z.infer<typeof SurfaceRuleSchema>;
export type DeadlineRule = z.infer<typeof DeadlineRuleSchema>;
export type ReaskRule = z.infer<typeof ReaskRuleSchema>;
export type WindowRule = z.infer<typeof WindowRuleSchema>;
export type BriefRule = z.infer<typeof BriefRuleSchema>;

// 発火予定 (実体化エンジンの出力)。key は PIM への冪等 upsert の突合キー。
export interface Occurrence {
  key: string;
  item_id: string;
  rule_id: string;
  kind: RuleKind;
  at: LocalDateTime;
  label: string;
}
