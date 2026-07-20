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

// Blob そのものではなくバイト列で持つ (iOS Safari の IndexedDB Blob 問題を避ける)
export interface BlobRow {
  file_id: string;
  bytes: ArrayBuffer;
  type: string;
}

export class YorozuDB extends Dexie {
  items!: EntityTable<Item, "id">;
  rules!: EntityTable<SurfaceRule, "id">;
  /** 端末ローカルの状態 (同期カーソル・設定)。同期対象外 */
  meta!: EntityTable<MetaRow, "key">;
  /** 未プッシュの journal エントリ (書き込みと同一トランザクションで積む) */
  outbox!: EntityTable<OutboxRow, "seq">;
  /** 添付 blob のローカルキャッシュ (#25)。journal には参照だけ流す */
  blobs!: EntityTable<BlobRow, "file_id">;

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
    this.version(3).stores({
      items: "id, status, updated_at",
      rules: "id, item_id, kind",
      meta: "key",
      outbox: "++seq",
      blobs: "file_id",
    });
    // 後から足した列を既存レコードに補う (これを怠ると UI が undefined 参照で白画面になる)
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("items")
          .toCollection()
          .modify((i: Record<string, unknown>) => {
            i.attachments ??= [];
            i.estimate_minutes ??= null;
          });
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
