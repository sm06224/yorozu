import { msAccessToken } from "../pim/msal";
import type { StorageProvider } from "./provider";

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

async function readText(name: string): Promise<string | null> {
  const res = await fetch(`${BASE}:/${name}:/content`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(
      `OneDrive 読込 ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return res.text();
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
}

export class OneDriveStorageProvider implements StorageProvider {
  readonly kind = "onedrive";
  readonly label = "OneDrive (approot)";

  private async lines(): Promise<string[]> {
    const text = await readText("journal.jsonl");
    return text ? text.split("\n").filter((l) => l.trim() !== "") : [];
  }

  async appendJournal(newLines: string[]): Promise<number> {
    const cur = await this.lines();
    const all = [...cur, ...newLines];
    await writeText("journal.jsonl", `${all.join("\n")}\n`);
    return all.length;
  }

  async readJournal(fromLine: number): Promise<string[]> {
    return (await this.lines()).slice(fromLine);
  }

  async journalLength(): Promise<number> {
    return (await this.lines()).length;
  }

  async writeSnapshot(json: string): Promise<void> {
    await writeText("snapshot.json", json);
  }

  async readSnapshot(): Promise<string | null> {
    return readText("snapshot.json");
  }
}
