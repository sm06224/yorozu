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
import { getDeviceId } from "../sync/device";
import type { JournalEntry } from "../sync/journal";
import { db as defaultDb, type YorozuDB } from "./db";

// 書き込みはすべてこのリポジトリ経由。updated_at (LWW キー) の更新と
// outbox (未プッシュ journal エントリ) への追記を同一トランザクションで行う。
// リモートから取り込む同期エンジンはここを通らない = echo しない。

export interface TriageDecision {
  status: Exclude<ItemStatus, "inbox">;
  /** 期日があれば deadline ルールを作る */
  due?: { date: LocalDate; time?: string; lead_days?: number[] };
  /** 再確認間隔 (日)。someday/waiting 向け */
  reask_days?: number;
  ai_allowed?: boolean;
}

export function makeRepo(db: YorozuDB) {
  function outboxUpsertItem(item: Item): JournalEntry {
    return { op: "upsert_item", device: getDeviceId(), payload: item };
  }

  async function captureItem(title: string, now = new Date()): Promise<Item> {
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
    await db.transaction("rw", db.items, db.outbox, async () => {
      await db.items.add(item);
      await db.outbox.add({ entry: outboxUpsertItem(item) });
    });
    return item;
  }

  async function updateItem(
    id: string,
    patch: Partial<Omit<Item, "id" | "created_at">>,
    now = new Date(),
  ): Promise<void> {
    const t = wallClockNow(now);
    await db.transaction("rw", db.items, db.outbox, async () => {
      await db.items.update(id, { ...patch, updated_at: t });
      const saved = await db.items.get(id);
      if (saved) await db.outbox.add({ entry: outboxUpsertItem(saved) });
    });
  }

  async function setStatus(
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

  /** トリアージ批准: ステータス確定 + 必要なルールを生成 (既存ルールは置き換え) */
  async function applyTriage(
    itemId: string,
    d: TriageDecision,
    now = new Date(),
  ): Promise<void> {
    const t = wallClockNow(now);
    const device = getDeviceId();
    await db.transaction("rw", db.items, db.rules, db.outbox, async () => {
      await db.items.update(itemId, {
        status: d.status,
        triaged_at: t,
        updated_at: t,
        ...(d.ai_allowed === undefined ? {} : { ai_allowed: d.ai_allowed }),
        ...(d.status === "done" ? { done_at: t } : {}),
      });
      const saved = await db.items.get(itemId);
      if (saved) await db.outbox.add({ entry: outboxUpsertItem(saved) });

      const old = await db.rules.where("item_id").equals(itemId).toArray();
      const oldDeadline = old.find((r) => r.kind === "deadline");
      const originalDue =
        oldDeadline?.kind === "deadline"
          ? (oldDeadline.original_due ?? oldDeadline.due)
          : null;
      for (const r of old) {
        await db.outbox.add({
          entry: { op: "delete_rule", device, id: r.id, ts: t },
        });
      }
      await db.rules.where("item_id").equals(itemId).delete();

      const rules: SurfaceRule[] = [];
      if (d.due) {
        rules.push(
          SurfaceRuleSchema.parse({
            id: newId(now),
            item_id: itemId,
            kind: "deadline",
            due: `${d.due.date}T${d.due.time ?? "09:00"}`,
            original_due: originalDue,
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
      if (rules.length > 0) {
        await db.rules.bulkAdd(rules);
        for (const r of rules) {
          await db.outbox.add({
            entry: { op: "upsert_rule", device, payload: r },
          });
        }
      }
    });
  }

  return { captureItem, updateItem, setStatus, applyTriage };
}

const repo = makeRepo(defaultDb);
export const captureItem = repo.captureItem;
export const updateItem = repo.updateItem;
export const setStatus = repo.setStatus;
export const applyTriage = repo.applyTriage;
