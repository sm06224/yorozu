import { z } from "zod";
import { ItemSchema, SurfaceRuleSchema } from "../core";

// journal.jsonl の1行 = 1エントリ (設計書 §3)。
// LWW の勝敗はエントリ順ではなく payload の updated_at で決める。
// 削除はトンボストーン (ts が相手の updated_at より新しければ勝ち)。

export const JournalEntrySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert_item"),
    device: z.string(),
    payload: ItemSchema,
  }),
  z.object({
    op: z.literal("upsert_rule"),
    device: z.string(),
    payload: SurfaceRuleSchema,
  }),
  z.object({
    op: z.literal("delete_item"),
    device: z.string(),
    id: z.string(),
    ts: z.string(),
  }),
  z.object({
    op: z.literal("delete_rule"),
    device: z.string(),
    id: z.string(),
    ts: z.string(),
  }),
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export function serializeEntry(e: JournalEntry): string {
  return JSON.stringify(e);
}

/** 壊れた行は null (スキップして同期を止めない) */
export function parseEntry(line: string): JournalEntry | null {
  try {
    return JournalEntrySchema.parse(JSON.parse(line));
  } catch {
    return null;
  }
}

export const SnapshotSchema = z.object({
  version: z.literal(1),
  /** この snapshot が journal の何行目までを含むか */
  journal_len: z.int().nonnegative(),
  items: z.array(ItemSchema),
  rules: z.array(SurfaceRuleSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
