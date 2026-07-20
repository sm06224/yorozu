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

/** snapshot に引き継ぐ削除記録。journal を compaction しても削除が復活しないように持ち回る */
export const TombstoneSchema = z.object({
  op: z.enum(["delete_item", "delete_rule"]),
  id: z.string(),
  ts: z.string(),
});
export type Tombstone = z.infer<typeof TombstoneSchema>;

export const SnapshotSchema = z.object({
  version: z.literal(1),
  /** この snapshot が journal の何行目までを含むか */
  journal_len: z.int().nonnegative(),
  items: z.array(ItemSchema),
  rules: z.array(SurfaceRuleSchema),
  /** 累積削除記録 (古いものは書き手が刈り込む)。無い旧形式は空扱い */
  tombstones: z.array(TombstoneSchema).default([]),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * snapshot 引き継ぎ分と journal 上の削除エントリを統合する。
 * (op, id) ごとに最新 ts を残し、cutoff より古いものは刈り込む。
 */
export function mergeTombstones(
  prev: readonly Tombstone[],
  entries: readonly JournalEntry[],
  cutoffTs: string,
): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  const put = (t: Tombstone) => {
    const key = `${t.op}:${t.id}`;
    const cur = byKey.get(key);
    if (!cur || t.ts > cur.ts) byKey.set(key, t);
  };
  for (const t of prev) put(t);
  for (const e of entries) {
    if (e.op === "delete_item" || e.op === "delete_rule") {
      put({ op: e.op, id: e.id, ts: e.ts });
    }
  }
  return [...byKey.values()]
    .filter((t) => t.ts >= cutoffTs)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
