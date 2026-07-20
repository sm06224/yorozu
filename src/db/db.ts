import Dexie, { type EntityTable } from "dexie";
import type { Item, SurfaceRule } from "../core";

// ローカル正 (設計書 §1)。IndexedDB が唯一の書き込み先で、
// 同期・PIM・AI はすべてここから読む。

export class YorozuDB extends Dexie {
  items!: EntityTable<Item, "id">;
  rules!: EntityTable<SurfaceRule, "id">;

  constructor(name = "yorozu") {
    super(name);
    this.version(1).stores({
      items: "id, status, updated_at",
      rules: "id, item_id, kind",
    });
  }
}

export const db = new YorozuDB();
