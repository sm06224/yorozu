import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { IdbStorageProvider } from "../sync/idb";
import { makeAttachments, remoteName } from "./attachments";
import { YorozuDB } from "./db";
import { makeRepo } from "./repo";

// blob は journal に入れない・参照だけ流れる・遅延ダウンロードできる、を検証。

let n = 0;
let a: YorozuDB;
let b: YorozuDB;
let remote: IdbStorageProvider;

beforeEach(() => {
  n += 1;
  a = new YorozuDB(`att-a-${n}`);
  b = new YorozuDB(`att-b-${n}`);
  remote = new IdbStorageProvider(`att-remote-${n}`);
});

function file(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

describe("attachments", () => {
  test("追加: blob はローカルへ、journal (outbox) には参照だけ", async () => {
    const item = await makeRepo(a).captureItem("スクショ付き");
    await a.outbox.clear(); // capture 分を除いて添付の entry だけ見る
    const att = makeAttachments(a, async () => null); // リモート未設定
    const ref = await att.addAttachment(item.id, file("shot.png", "PNGDATA"));

    expect((await a.blobs.get(ref.file_id))?.bytes.byteLength).toBe(7);
    const saved = await a.items.get(item.id);
    expect(saved?.attachments).toEqual([ref]);

    const entries = await a.outbox.toArray();
    expect(entries).toHaveLength(1);
    const line = JSON.stringify(entries[0]?.entry);
    expect(line).toContain(ref.file_id); // 参照は流れる
    expect(line).not.toContain("PNGDATA"); // 本体は流れない
    expect(line.length).toBeLessThan(2000);
  });

  test("リモートありなら即アップロード、保留は空になる", async () => {
    const item = await makeRepo(a).captureItem("x");
    const att = makeAttachments(a, async () => remote);
    const ref = await att.addAttachment(item.id, file("memo.txt", "hello"));

    const up = await remote.getFile(remoteName(ref.file_id));
    expect(up).not.toBeNull();
    expect(await up?.text()).toBe("hello");
  });

  test("リモート未設定で保留 → 後から pushPending で追いつく", async () => {
    const item = await makeRepo(a).captureItem("x");
    let provider: IdbStorageProvider | null = null;
    const att = makeAttachments(a, async () => provider);
    const ref = await att.addAttachment(item.id, file("late.txt", "later"));
    expect(await remote.getFile(remoteName(ref.file_id))).toBeNull();

    provider = remote; // 同期先が設定された
    const uploaded = await att.pushPendingAttachments();
    expect(uploaded).toBe(1);
    expect(await remote.getFile(remoteName(ref.file_id))).not.toBeNull();
    // 2回目は何もしない
    expect(await att.pushPendingAttachments()).toBe(0);
  });

  test("別端末はローカルに無い blob を遅延ダウンロードしてキャッシュする", async () => {
    const item = await makeRepo(a).captureItem("x");
    const attA = makeAttachments(a, async () => remote);
    const ref = await attA.addAttachment(item.id, file("pic.png", "IMG"));

    const attB = makeAttachments(b, async () => remote);
    const blob = await attB.getAttachmentBlob(ref.file_id);
    expect(await blob?.text()).toBe("IMG");
    // キャッシュされた (リモートを外しても読める)
    const attB2 = makeAttachments(b, async () => null);
    expect(await (await attB2.getAttachmentBlob(ref.file_id))?.text()).toBe(
      "IMG",
    );
  });

  test("削除: 参照とローカル blob が消える (リモート本体は残す)", async () => {
    const item = await makeRepo(a).captureItem("x");
    const att = makeAttachments(a, async () => remote);
    const ref = await att.addAttachment(item.id, file("del.txt", "bye"));
    await att.removeAttachment(item.id, ref.file_id);

    expect((await a.items.get(item.id))?.attachments).toEqual([]);
    expect(await a.blobs.get(ref.file_id)).toBeUndefined();
    expect(await remote.getFile(remoteName(ref.file_id))).not.toBeNull();
  });
});
