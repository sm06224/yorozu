import { db, getMeta, setMeta } from "../db/db";
import { dlog } from "../debug/log";
import { gAccessToken } from "../google/auth";
import type { StorageProvider } from "./provider";
import {
  type ParsedJournal,
  parseJournalText,
  serializeJournalText,
} from "./textjournal";

// Google Drive (appDataFolder) アダプタ (設計書 §1/§3)。
// OneDrive approot と同じ2ファイル (journal.jsonl / snapshot.json) + att-*。
// appDataFolder はアプリ専用の隠しフォルダ (drive.appdata スコープのみで読み書き可)。
// ファイル名→id の対応は meta にキャッシュする (Drive は名前でなく id が正)。

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

function getToken(): string {
  const t = gAccessToken(false);
  if (!t)
    throw new Error(
      "Google にサインインしていません (設定 → Google 連携)。トークン切れの場合は設定画面のサインインを押してください",
    );
  return t;
}

async function findFileId(name: string): Promise<string | null> {
  const cached = await getMeta<string>(db, `gdrive.id.${name}`);
  if (cached) return cached;
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}'`);
  const res = await fetch(
    `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=10`,
    { headers: { Authorization: `Bearer ${getToken()}` } },
  );
  if (!res.ok)
    throw new Error(
      `Drive 検索 ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const data = (await res.json()) as { files: Array<{ id: string }> };
  const id = data.files[0]?.id ?? null;
  if (id) await setMeta(db, `gdrive.id.${name}`, id);
  return id;
}

async function readBlob(name: string): Promise<Blob | null> {
  const id = await findFileId(name);
  if (!id) {
    dlog("gdrive", `read ${name}: 未作成`);
    return null;
  }
  const res = await fetch(`${API}/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(
      `Drive 読込 ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const blob = await res.blob();
  dlog("gdrive", `read ${name}: ${blob.size}B`);
  return blob;
}

async function readText(name: string): Promise<string | null> {
  const blob = await readBlob(name);
  return blob ? blob.text() : null;
}

async function writeBlob(name: string, data: Blob): Promise<void> {
  const id = await findFileId(name);
  if (id) {
    const res = await fetch(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": data.type || "application/octet-stream",
      },
      body: data,
    });
    if (!res.ok)
      throw new Error(
        `Drive 更新 ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
  } else {
    // 新規作成は multipart (メタデータで appDataFolder 配下を指定)
    const meta = JSON.stringify({ name, parents: ["appDataFolder"] });
    const boundary = `yorozu${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${data.type || "application/octet-stream"}\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ]);
    const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok)
      throw new Error(
        `Drive 作成 ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const created = (await res.json()) as { id: string };
    await setMeta(db, `gdrive.id.${name}`, created.id);
  }
  dlog("gdrive", `write ${name}: ${data.size}B ok`);
}

async function writeText(name: string, content: string): Promise<void> {
  await writeBlob(name, new Blob([content], { type: "text/plain" }));
}

export class GDriveStorageProvider implements StorageProvider {
  readonly kind = "gdrive";
  readonly label = "Google Drive (appDataFolder)";

  private async journal(): Promise<ParsedJournal> {
    return parseJournalText(await readText("journal.jsonl"));
  }

  async appendJournal(newLines: string[]): Promise<number> {
    const j = await this.journal();
    const all = [...j.lines, ...newLines];
    await writeText("journal.jsonl", serializeJournalText(j.base, all));
    return j.base + all.length;
  }

  async readJournal(fromLine: number): Promise<string[]> {
    const j = await this.journal();
    return j.lines.slice(Math.max(0, fromLine - j.base));
  }

  async journalLength(): Promise<number> {
    const j = await this.journal();
    return j.base + j.lines.length;
  }

  async journalBase(): Promise<number> {
    return (await this.journal()).base;
  }

  async compactJournal(upToLine: number): Promise<void> {
    const j = await this.journal();
    if (upToLine <= j.base) return;
    await writeText(
      "journal.jsonl",
      serializeJournalText(upToLine, j.lines.slice(upToLine - j.base)),
    );
  }

  async writeSnapshot(json: string): Promise<void> {
    await writeText("snapshot.json", json);
  }

  async readSnapshot(): Promise<string | null> {
    return readText("snapshot.json");
  }

  async putFile(name: string, data: Blob): Promise<void> {
    await writeBlob(name, data);
  }

  async getFile(name: string): Promise<Blob | null> {
    return readBlob(name);
  }
}
