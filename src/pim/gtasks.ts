import type { Occurrence } from "../core";
import { dateOf } from "../core";
import { db, getMeta, setMeta } from "../db/db";
import { dlog } from "../debug/log";
import { gAccessToken } from "../google/auth";
import { bodyWithKey, extractKey, type PimProvider } from "./provider";

// Google Tasks アダプタ (#40)。再確認/期間系を専用リスト「YOROZU」のタスクに。
// 突合は notes 内の yorozu-key。Google Tasks の期日は日付精度のみ。

const API = "https://www.googleapis.com/tasks/v1";
const LIST_NAME = "YOROZU";
const LIST_META = "pim.gtasklist.id";

function getToken(): string {
  const t = gAccessToken(false);
  if (!t) throw new Error("Google にサインインしていません");
  return t;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok)
    throw new Error(
      `GTasks ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()) as T;
}

async function ensureListId(): Promise<string> {
  const cached = await getMeta<string>(db, LIST_META);
  if (cached) return cached;
  const lists = await api<{ items?: Array<{ id: string; title: string }> }>(
    "/users/@me/lists?maxResults=100",
  );
  let id = (lists.items ?? []).find((l) => l.title === LIST_NAME)?.id;
  if (!id) {
    const created = await api<{ id: string }>("/users/@me/lists", {
      method: "POST",
      body: JSON.stringify({ title: LIST_NAME }),
    });
    id = created.id;
    dlog("gtasks", `リスト ${LIST_NAME} を作成`);
  }
  await setMeta(db, LIST_META, id);
  return id;
}

export class GTasksPimProvider implements PimProvider {
  readonly kind = "gtasks";

  async listExistingKeys(): Promise<Set<string>> {
    const listId = await ensureListId();
    const tasks = await api<{ items?: Array<{ notes?: string }> }>(
      `/lists/${listId}/tasks?maxResults=100&showCompleted=true&showHidden=true`,
    );
    const keys = new Set<string>();
    for (const t of tasks.items ?? []) {
      const k = extractKey(t.notes ?? "");
      if (k) keys.add(k);
    }
    dlog("gtasks", `existing keys=${keys.size}`);
    return keys;
  }

  async createEntries(occurrences: readonly Occurrence[]): Promise<void> {
    const listId = await ensureListId();
    for (const o of occurrences) {
      await api(`/lists/${listId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: o.label,
          notes: bodyWithKey(o.key),
          due: `${dateOf(o.at)}T00:00:00.000Z`, // Tasks の期日は日付精度
        }),
      });
    }
    if (occurrences.length > 0)
      dlog("gtasks", `created ${occurrences.length} tasks`);
  }
}
