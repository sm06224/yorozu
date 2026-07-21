import { getMeta, setMeta, type YorozuDB } from "../db/db";
import { ensurePermission, FsaStorageProvider } from "./fsa";
import { IdbStorageProvider } from "./idb";
import type { StorageProvider } from "./provider";

export type SyncKind = "none" | "idb" | "fsa" | "onedrive" | "gdrive";

const KIND_KEY = "sync.kind";
const FSA_HANDLE_KEY = "sync.fsa_handle";

export async function getSyncKind(db: YorozuDB): Promise<SyncKind> {
  return (await getMeta<SyncKind>(db, KIND_KEY)) ?? "none";
}

export async function setSyncKind(db: YorozuDB, kind: SyncKind): Promise<void> {
  await setMeta(db, KIND_KEY, kind);
}

export async function saveFsaHandle(
  db: YorozuDB,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  // FileSystemDirectoryHandle は structured clone 可能で IndexedDB に永続化できる
  await setMeta(db, FSA_HANDLE_KEY, handle);
}

/**
 * 設定済みの StorageProvider を返す。未設定・権限なしは null。
 * FSA の権限再要求はユーザー操作起点でのみ成功するため、
 * 自動同期時は interactive=false で静かに諦める。
 */
export async function getConfiguredProvider(
  db: YorozuDB,
  interactive: boolean,
): Promise<StorageProvider | null> {
  const kind = await getSyncKind(db);
  if (kind === "idb") return new IdbStorageProvider();
  if (kind === "onedrive") {
    const { OneDriveStorageProvider } = await import("./onedrive");
    const { msAccount } = await import("../pim/msal");
    if (!(await msAccount())) return null; // 未サインインなら静かに諦める
    return new OneDriveStorageProvider();
  }
  if (kind === "gdrive") {
    const { gAccessToken } = await import("../google/auth");
    // 未サインイン/トークン切れは静かに諦める (interactive はユーザー操作起点のみ)
    if (!gAccessToken(interactive)) return null;
    const { GDriveStorageProvider } = await import("./gdrive");
    return new GDriveStorageProvider();
  }
  if (kind === "fsa") {
    const handle = await getMeta<FileSystemDirectoryHandle>(db, FSA_HANDLE_KEY);
    if (!handle) return null;
    if (interactive) {
      if (!(await ensurePermission(handle))) return null;
    } else if (
      (await handle.queryPermission({ mode: "readwrite" })) !== "granted"
    ) {
      return null;
    }
    return new FsaStorageProvider(handle);
  }
  return null;
}
