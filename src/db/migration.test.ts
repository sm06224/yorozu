import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, test } from "vitest";
import { YorozuDB } from "./db";

// 白画面バグの回帰テスト: 旧スキーマ (attachments 列なし) で保存された
// アイテムが、新スキーマで開いた時に補完されていること。

async function writeLegacyDb(name: string): Promise<void> {
  // v2 当時のスキーマを再現して、attachments/estimate_minutes の無い item を書く
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    items: "id, status, updated_at",
    rules: "id, item_id, kind",
  });
  legacy.version(2).stores({
    items: "id, status, updated_at",
    rules: "id, item_id, kind",
    meta: "key",
    outbox: "++seq",
  });
  await legacy.table("items").put({
    id: "legacy1",
    space_id: null,
    title: "旧形式アイテム",
    body: "",
    status: "active",
    tags: [],
    ai_allowed: true,
    created_at: "2026-07-01T08:00",
    updated_at: "2026-07-01T08:00",
    triaged_at: null,
    done_at: null,
  });
  legacy.close();
}

describe("スキーマ移行", () => {
  test("旧レコードに attachments/estimate_minutes が補完される", async () => {
    const name = "migration-test-1";
    await writeLegacyDb(name);

    const db = new YorozuDB(name);
    const item = await db.items.get("legacy1");
    expect(item).toBeDefined();
    expect(item?.attachments).toEqual([]);
    expect(item?.estimate_minutes).toBeNull();
    db.close();
  });
});
