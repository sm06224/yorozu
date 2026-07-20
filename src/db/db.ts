import Dexie, { type EntityTable } from "dexie";
import type { Item, SurfaceRule } from "../core";
import type { JournalEntry } from "../sync/journal";

// ローカル正 (設計書 §1)。IndexedDB が唯一の書き込み先で、
// 同期・PIM・AI はすべてここから読む。

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface OutboxRow {
  seq: number;
  entry: JournalEntry;
}

export class YorozuDB extends Dexie {
  items!: EntityTable<Item, "id">;
  rules!: EntityTable<SurfaceRule, "id">;
  /** 端末ローカルの状態 (同期カーソル・設定)。同期対象外 */
  meta!: EntityTable<MetaRow, "key">;
  /** 未プッシュの journal エントリ (書き込みと同一トランザクションで積む) */
  outbox!: EntityTable<OutboxRow, "seq">;

  constructor(name = "yorozu") {
    super(name);
    this.version(1).stores({
      items: "id, status, updated_at",
      rules: "id, item_id, kind",
    });
    this.version(2).stores({
      items: "id, status, updated_at",
      rules: "id, item_id, kind",
      meta: "key",
      outbox: "++seq",
    });
  }
}

export const db = new YorozuDB();

export async function getMeta<T>(
  d: YorozuDB,
  key: string,
): Promise<T | undefined> {
  const row = await d.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(
  d: YorozuDB,
  key: string,
  value: unknown,
): Promise<void> {
  await d.meta.put({ key, value });
}
