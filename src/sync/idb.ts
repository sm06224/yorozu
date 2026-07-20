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

  private async base(): Promise<number> {
    const row = await this.db.kv.get("journal_base");
    return row ? Number(row.value) : 0;
  }

  async appendJournal(lines: string[]): Promise<number> {
    await this.db.lines.bulkAdd(lines.map((line) => ({ line })) as LineRow[]);
    return (await this.base()) + (await this.db.lines.count());
  }

  async readJournal(fromLine: number): Promise<string[]> {
    const local = Math.max(0, fromLine - (await this.base()));
    const rows = await this.db.lines.orderBy("seq").offset(local).toArray();
    return rows.map((r) => r.line);
  }

  async journalLength(): Promise<number> {
    return (await this.base()) + (await this.db.lines.count());
  }

  async journalBase(): Promise<number> {
    return this.base();
  }

  async compactJournal(upToLine: number): Promise<void> {
    const base = await this.base();
    if (upToLine <= base) return;
    const drop = await this.db.lines
      .orderBy("seq")
      .limit(upToLine - base)
      .primaryKeys();
    await this.db.lines.bulkDelete(drop);
    await this.db.kv.put({ key: "journal_base", value: String(upToLine) });
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
