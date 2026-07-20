import Dexie, { type EntityTable } from "dexie";
import type { StorageProvider } from "./provider";

// ブラウザ内 IndexedDB を「リモート」に見立てるアダプタ。
// 用途: 開発・スモークテスト・同期エンジンの検証 (設計書のリモートは OneDrive/Google)。

interface LineRow {
  seq: number;
  line: string;
}

interface KvRow {
  key: string;
  value: string;
}

interface FileRow {
  name: string;
  blob: Blob;
}

class RemoteDB extends Dexie {
  lines!: EntityTable<LineRow, "seq">;
  kv!: EntityTable<KvRow, "key">;
  files!: EntityTable<FileRow, "name">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ lines: "++seq", kv: "key" });
    this.version(2).stores({ lines: "++seq", kv: "key", files: "name" });
  }
}

export class IdbStorageProvider implements StorageProvider {
  readonly kind = "idb";
  readonly label = "このブラウザ (IndexedDB)";
  private db: RemoteDB;

  constructor(name = "yorozu-remote") {
    this.db = new RemoteDB(name);
  }

  async appendJournal(lines: string[]): Promise<number> {
    await this.db.lines.bulkAdd(lines.map((line) => ({ line })) as LineRow[]);
    return this.db.lines.count();
  }

  async readJournal(fromLine: number): Promise<string[]> {
    const rows = await this.db.lines.orderBy("seq").offset(fromLine).toArray();
    return rows.map((r) => r.line);
  }

  async journalLength(): Promise<number> {
    return this.db.lines.count();
  }

  async writeSnapshot(json: string): Promise<void> {
    await this.db.kv.put({ key: "snapshot", value: json });
  }

  async readSnapshot(): Promise<string | null> {
    const row = await this.db.kv.get("snapshot");
    return row?.value ?? null;
  }

  async putFile(name: string, data: Blob): Promise<void> {
    await this.db.files.put({ name, blob: data });
  }
}
