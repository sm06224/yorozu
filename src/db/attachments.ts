import { type AttachmentRef, newId } from "../core";
import { getConfiguredProvider } from "../sync/config";
import type { StorageProvider } from "../sync/provider";
import { db as defaultDb, getMeta, setMeta, type YorozuDB } from "./db";
import { makeRepo } from "./repo";

// 添付ファイル (#25): blob は journal に入れない。
// - 参照 (file_id/name/size/mime) は item.attachments として journal で同期
// - 本体はローカル IndexedDB (blobs) + 同期先の att-{file_id} (putFile/getFile)
// - リモート未設定/オフラインでも動く: 保留キューに積み、開時同期で追いつく

const PENDING_META = "att.pending";

/** 同期先でのファイル名 (フラット。元のファイル名は参照側に持つ) */
export function remoteName(fileId: string): string {
  return `att-${fileId}`;
}

export function makeAttachments(
  db: YorozuDB,
  getProvider: () => Promise<StorageProvider | null> = () =>
    getConfiguredProvider(db, false),
) {
  const repo = makeRepo(db);

  async function pending(): Promise<string[]> {
    return (await getMeta<string[]>(db, PENDING_META)) ?? [];
  }

  async function setPending(ids: string[]): Promise<void> {
    await setMeta(db, PENDING_META, ids);
  }

  /** 添付を追加: blob をローカル保存し、参照を item に足し、アップロードを試みる */
  async function addAttachment(
    itemId: string,
    file: File,
    now = new Date(),
  ): Promise<AttachmentRef> {
    const item = await db.items.get(itemId);
    if (!item) throw new Error("アイテムが見つかりません");
    const ref: AttachmentRef = {
      file_id: newId(now),
      name: file.name,
      size: file.size,
      mime: file.type,
    };
    await db.blobs.put({
      file_id: ref.file_id,
      bytes: await file.arrayBuffer(),
      type: file.type,
    });
    await repo.updateItem(
      itemId,
      { attachments: [...item.attachments, ref] },
      now,
    );
    await setPending([...(await pending()), ref.file_id]);
    await pushPendingAttachments().catch(() => undefined); // 失敗は保留のまま
    return ref;
  }

  /** blob を取得: ローカルに無ければ同期先から遅延ダウンロードしてキャッシュ */
  async function getAttachmentBlob(fileId: string): Promise<Blob | null> {
    const local = await db.blobs.get(fileId);
    if (local) return new Blob([local.bytes], { type: local.type });
    const provider = await getProvider();
    if (!provider?.getFile) return null;
    const blob = await provider.getFile(remoteName(fileId));
    if (blob) {
      await db.blobs.put({
        file_id: fileId,
        bytes: await blob.arrayBuffer(),
        type: blob.type,
      });
    }
    return blob;
  }

  /** 参照とローカル blob を消す (リモートの本体はバックアップとして残す) */
  async function removeAttachment(
    itemId: string,
    fileId: string,
    now = new Date(),
  ): Promise<void> {
    const item = await db.items.get(itemId);
    if (!item) return;
    await repo.updateItem(
      itemId,
      { attachments: item.attachments.filter((a) => a.file_id !== fileId) },
      now,
    );
    await db.blobs.delete(fileId);
    await setPending((await pending()).filter((id) => id !== fileId));
  }

  /** 保留中の blob を同期先へアップロードする (開時同期から呼ぶ) */
  async function pushPendingAttachments(): Promise<number> {
    const ids = await pending();
    if (ids.length === 0) return 0;
    const provider = await getProvider();
    if (!provider?.putFile) return 0;
    let uploaded = 0;
    const rest: string[] = [];
    for (const id of ids) {
      const row = await db.blobs.get(id);
      if (!row) continue; // blob が消えた参照は保留から外す
      try {
        await provider.putFile(
          remoteName(id),
          new Blob([row.bytes], { type: row.type }),
        );
        uploaded += 1;
      } catch {
        rest.push(id); // 失敗分は次回へ
      }
    }
    await setPending(rest);
    return uploaded;
  }

  return {
    addAttachment,
    getAttachmentBlob,
    removeAttachment,
    pushPendingAttachments,
  };
}

const attachments = makeAttachments(defaultDb);
export const addAttachment = attachments.addAttachment;
export const getAttachmentBlob = attachments.getAttachmentBlob;
export const removeAttachment = attachments.removeAttachment;
export const pushPendingAttachments = attachments.pushPendingAttachments;
