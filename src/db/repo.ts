import {
  type Item,
  ItemSchema,
  type ItemStatus,
  type LocalDate,
  newId,
  type SurfaceRule,
  SurfaceRuleSchema,
  wallClockNow,
} from "../core";
import { db } from "./db";

// 書き込みはすべてこのリポジトリ経由。updated_at (LWW キー) の更新を一元化する。

export async function captureItem(
  title: string,
  now = new Date(),
): Promise<Item> {
  const t = wallClockNow(now);
  const item = ItemSchema.parse({
    id: newId(now),
    space_id: null,
    title: title.trim(),
    body: "",
    status: "inbox",
    tags: [],
    ai_allowed: true,
    created_at: t,
    updated_at: t,
    triaged_at: null,
    done_at: null,
  });
  await db.items.add(item);
  return item;
}

export async function updateItem(
  id: string,
  patch: Partial<Omit<Item, "id" | "created_at">>,
  now = new Date(),
): Promise<void> {
  const t = wallClockNow(now);
  await db.items.update(id, { ...patch, updated_at: t });
}

export async function setStatus(
  id: string,
  status: ItemStatus,
  now = new Date(),
): Promise<void> {
  const t = wallClockNow(now);
  await updateItem(
    id,
    status === "done" ? { status, done_at: t } : { status, done_at: null },
    now,
  );
}

export interface TriageDecision {
  status: Exclude<ItemStatus, "inbox">;
  /** 期日があれば deadline ルールを作る */
  due?: { date: LocalDate; time?: string; lead_days?: number[] };
  /** 再確認間隔 (日)。someday/waiting 向け */
  reask_days?: number;
  ai_allowed?: boolean;
}

/** トリアージ批准: ステータス確定 + 必要なルールを生成 (既存ルールは置き換え) */
export async function applyTriage(
  itemId: string,
  d: TriageDecision,
  now = new Date(),
): Promise<void> {
  const t = wallClockNow(now);
  await db.transaction("rw", db.items, db.rules, async () => {
    await db.items.update(itemId, {
      status: d.status,
      triaged_at: t,
      updated_at: t,
      ...(d.ai_allowed === undefined ? {} : { ai_allowed: d.ai_allowed }),
      ...(d.status === "done" ? { done_at: t } : {}),
    });
    await db.rules.where("item_id").equals(itemId).delete();
    const rules: SurfaceRule[] = [];
    if (d.due) {
      rules.push(
        SurfaceRuleSchema.parse({
          id: newId(now),
          item_id: itemId,
          kind: "deadline",
          due: `${d.due.date}T${d.due.time ?? "09:00"}`,
          lead_days: d.due.lead_days ?? [7, 1, 0],
          enabled: true,
          created_at: t,
          updated_at: t,
        }),
      );
    }
    if (d.reask_days) {
      rules.push(
        SurfaceRuleSchema.parse({
          id: newId(now),
          item_id: itemId,
          kind: "reask",
          anchor: t.slice(0, 10),
          interval_days: d.reask_days,
          enabled: true,
          created_at: t,
          updated_at: t,
        }),
      );
    }
    if (rules.length > 0) await db.rules.bulkAdd(rules);
  });
}
