import type { StorageProvider } from "./provider";

// File System Access API アダプタ。ユーザーが選んだフォルダ (例: iCloud/OneDrive の
// ローカル同期フォルダ) に journal/snapshot を置く。ブラウザ対応は Chromium 系のみ。

const JOURNAL = "journal.jsonl";
const SNAPSHOT = "snapshot.json";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
  // FSA の権限 API は TS の lib.dom にまだ無いため補完する
  interface FileSystemHandle {
    queryPermission(descriptor?: {
      mode?: "read" | "readwrite";
    }): Promise<PermissionState>;
    requestPermission(descriptor?: {
      mode?: "read" | "readwrite";
    }): Promise<PermissionState>;
  }
}

export function fsaSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

export async function pickSyncFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({
      mode: "readwrite",
      id: "yorozu-sync",
    });
  } catch {
    return null; // ユーザーキャンセル
  }
}

/** 保存済みハンドルの権限を確認し、必要なら (ユーザー操作起点で) 再要求する */
export async function ensurePermission(
  dir: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: "readwrite" } as const;
  if ((await dir.queryPermission(opts)) === "granted") return true;
  return (await dir.requestPermission(opts)) === "granted";
}

export class FsaStorageProvider implements StorageProvider {
  readonly kind = "fsa";
  readonly label = "フォルダ (File System Access)";
  private dir: FileSystemDirectoryHandle;

  constructor(dir: FileSystemDirectoryHandle) {
    this.dir = dir;
  }

  private async readFile(name: string): Promise<string | null> {
    try {
      const handle = await this.dir.getFileHandle(name);
      const file = await handle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  private async readJournalLines(): Promise<string[]> {
    const text = await this.readFile(JOURNAL);
    if (!text) return [];
    return text.split("\n").filter((l) => l.trim() !== "");
  }

  async appendJournal(lines: string[]): Promise<number> {
    const handle = await this.dir.getFileHandle(JOURNAL, { create: true });
    const file = await handle.getFile();
    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.seek(file.size);
    const prefix =
      file.size > 0 && !(await file.text()).endsWith("\n") ? "\n" : "";
    await writable.write(`${prefix}${lines.join("\n")}\n`);
    await writable.close();
    return (await this.readJournalLines()).length;
  }

  async readJournal(fromLine: number): Promise<string[]> {
    return (await this.readJournalLines()).slice(fromLine);
  }

  async journalLength(): Promise<number> {
    return (await this.readJournalLines()).length;
  }

  async writeSnapshot(json: string): Promise<void> {
    const handle = await this.dir.getFileHandle(SNAPSHOT, { create: true });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
  }

  async readSnapshot(): Promise<string | null> {
    return this.readFile(SNAPSHOT);
  }

  async putFile(name: string, data: Blob): Promise<void> {
    const handle = await this.dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }
}
