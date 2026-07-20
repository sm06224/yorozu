import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { YorozuDB } from "../db/db";
import { makeRepo } from "../db/repo";
import { syncOnce } from "./engine";
import { IdbStorageProvider } from "./idb";

// 2端末 (a, b) が1つのリモート (IdbStorageProvider) を介して同期するシナリオ。

let a: YorozuDB;
let b: YorozuDB;
let remote: IdbStorageProvider;
let n = 0;

beforeEach(() => {
  n += 1;
  a = new YorozuDB(`test-a-${n}`);
  b = new YorozuDB(`test-b-${n}`);
  remote = new IdbStorageProvider(`test-remote-${n}`);
});

const at = (min: number) => new Date(Date.UTC(2026, 6, 20, 10, min));

describe("syncOnce", () => {
  test("Aのキャプチャが同期でBに現れる", async () => {
    const item = await makeRepo(a).captureItem("牛乳", at(0));
    const ra = await syncOnce(a, remote);
    expect(ra.pushed).toBe(1);
    const rb = await syncOnce(b, remote);
    expect(rb.applied).toBe(1);
    expect((await b.items.get(item.id))?.title).toBe("牛乳");
  });

  test("Bのトリアージ (ルール生成含む) がAに伝播する", async () => {
    const item = await makeRepo(a).captureItem("請求書", at(0));
    await syncOnce(a, remote);
    await syncOnce(b, remote);

    await makeRepo(b).applyTriage(
      item.id,
      { status: "active", due: { date: "2026-08-01" } },
      at(1),
    );
    await syncOnce(b, remote);
    await syncOnce(a, remote);

    expect((await a.items.get(item.id))?.status).toBe("active");
    const rules = await a.rules.where("item_id").equals(item.id).toArray();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.kind).toBe("deadline");
  });

  test("LWW: 後勝ち (updated_at 比較)", async () => {
    const item = await makeRepo(a).captureItem("元タイトル", at(0));
    await syncOnce(a, remote);
    await syncOnce(b, remote);

    await makeRepo(b).updateItem(item.id, { title: "B編集(遅)" }, at(5));
    await makeRepo(a).updateItem(item.id, { title: "A編集(早)" }, at(2));
    await syncOnce(b, remote);
    await syncOnce(a, remote); // pull B(遅) → 勝ち。push A(早)
    await syncOnce(b, remote); // pull A(早) → 負け

    expect((await a.items.get(item.id))?.title).toBe("B編集(遅)");
    expect((await b.items.get(item.id))?.title).toBe("B編集(遅)");
  });

  test("ルール置き換えのトンボストーンが伝播する", async () => {
    const repoA = makeRepo(a);
    const item = await repoA.captureItem("x", at(0));
    await repoA.applyTriage(
      item.id,
      { status: "active", due: { date: "2026-08-01" } },
      at(1),
    );
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    expect(await b.rules.count()).toBe(1);

    // 再トリアージで deadline → reask に置き換え
    await repoA.applyTriage(
      item.id,
      { status: "someday", reask_days: 30 },
      at(2),
    );
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    const rules = await b.rules.toArray();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.kind).toBe("reask");
  });

  test("echoしない: 同期を繰り返しても journal が伸びない", async () => {
    await makeRepo(a).captureItem("x", at(0));
    await syncOnce(a, remote);
    const len1 = await remote.journalLength();
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    expect(await remote.journalLength()).toBe(len1);
    expect(await a.outbox.count()).toBe(0);
  });

  test("outbox消費済みでも空リモートへの初回同期で全量を種まきする", async () => {
    const repoA = makeRepo(a);
    await repoA.captureItem("既存アイテム", at(0));
    await syncOnce(a, remote); // outbox はここで消費される

    // 別のリモート (乗り換え/追加) に同期しても全量が上がる
    const remote2 = new IdbStorageProvider(`test-remote2-${n}`);
    Object.defineProperty(remote2, "kind", { value: "idb2" }); // カーソルを別キーに
    const r = await syncOnce(a, remote2);
    expect(r.pushed).toBe(1);
    expect(await remote2.journalLength()).toBe(1);

    const rb = await syncOnce(b, remote2);
    expect(rb.applied).toBe(1);
    expect(await b.items.count()).toBe(1);
  });

  test("新規端末は snapshot からブートストラップできる", async () => {
    const repoA = makeRepo(a);
    for (let i = 0; i < 5; i += 1) {
      await repoA.captureItem(`item-${i}`, at(i));
    }
    await syncOnce(a, remote); // 初回同期で snapshot も書かれる
    expect(await remote.readSnapshot()).not.toBeNull();

    const c = new YorozuDB(`test-c-${n}`);
    const rc = await syncOnce(c, remote);
    expect(await c.items.count()).toBe(5);
    // snapshot 経由なので journal の再取込は 0 行
    expect(rc.pulled).toBe(0);
  });
});
