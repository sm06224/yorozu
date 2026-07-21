import { dlog } from "../debug/log";
import { msAccessToken } from "../pim/msal";
import type { StorageProvider } from "./provider";
import {
  type ParsedJournal,
  parseJournalText,
  serializeJournalText,
} from "./textjournal";

// OneDrive approot アダプタ (設計書 §1, §3, #16)。
// app 専用フォルダ (Files.ReadWrite.AppFolder) に journal.jsonl / snapshot.json を置く。
// 追記は read-modify-write (書き手は実質1人 = 競合は稀、LWW で許容する設計)。

const BASE = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

async function getToken(): Promise<string> {
  const t = await msAccessToken(false);
  if (!t)
    throw new Error(
      "Microsoft にサインインしていません (設定 → Microsoft 連携)",
    );
  return t;
}

// ファイル内容の取得は2段: (1) Graph でメタデータから downloadUrl を得る (JSON 直返し)、
// (2) 事前認証済み downloadUrl を Authorization ヘッダ無しで読む。
// /content 直 GET は 302 でダウンロードドメインへ飛び、Safari では
// Authorization 付きクロスオリジンリダイレクトが "Load failed" になるため使わない。
async function downloadUrlOf(name: string): Promise<string | null> {
  const res = await fetch(`${BASE}:/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (res.status === 404) {
    dlog("onedrive", `meta ${name}: 404 (未作成)`);
    return null;
  }
  if (!res.ok)
    throw new Error(
      `OneDrive メタ取得 ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const meta = (await res.json()) as Record<string, unknown>;
  const url = meta["@microsoft.graph.downloadUrl"];
  dlog(
    "onedrive",
    `meta ${name}: size=${meta.size} downloadUrl=${typeof url === "string" ? new URL(url).host : "無し!"}`,
  );
  return typeof url === "string" ? url : null;
}

async function readBlob(name: string): Promise<Blob | null> {
  const url = await downloadUrlOf(name);
  if (!url) return null;
  const res = await fetch(url); // 事前認証済み URL: ヘッダ不要・CORS 可
  if (!res.ok) throw new Error(`OneDrive ダウンロード ${res.status}`);
  const blob = await res.blob();
  dlog("onedrive", `download ${name}: ${blob.size}B`);
  return blob;
}

async function readText(name: string): Promise<string | null> {
  const blob = await readBlob(name);
  return blob ? blob.text() : null;
}

async function writeText(name: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}:/${name}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "text/plain",
    },
    body: content,
  });
  if (!res.ok)
    throw new Error(
      `OneDrive 書込 ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  dlog("onedrive", `put ${name}: ${content.length}B ok`);
}

export class OneDriveStorageProvider implements StorageProvider {
  readonly kind = "onedrive";
  readonly label = "OneDrive (approot)";

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
    const keep = j.lines.slice(upToLine - j.base);
    await writeText("journal.jsonl", serializeJournalText(upToLine, keep));
  }

  async writeSnapshot(json: string): Promise<void> {
    await writeText("snapshot.json", json);
  }

  async readSnapshot(): Promise<string | null> {
    return readText("snapshot.json");
  }

  async putFile(name: string, data: Blob): Promise<void> {
    const res = await fetch(`${BASE}:/${name}:/content`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "Content-Type": data.type || "application/octet-stream",
      },
      body: data,
    });
    if (!res.ok)
      throw new Error(
        `OneDrive 書込 ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    dlog("onedrive", `putFile ${name}: ${data.size}B ok`);
  }

  async getFile(name: string): Promise<Blob | null> {
    return readBlob(name);
  }
}
