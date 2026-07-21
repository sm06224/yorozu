import type { Occurrence } from "../core";
import { db, getMeta, setMeta } from "../db/db";
import { dlog } from "../debug/log";
import { msAccessToken } from "./msal";
import { bodyWithKey, extractKey, type PimProvider } from "./provider";

// Microsoft To Do アダプタ (設計書 §2, #17)。
// reask/window 系 (「まだ要る?」「開始」) はカレンダーの予定より
// タスクの方が意味が合う。専用リスト「YOROZU」に冪等 upsert する。
// 意思決定 (何を作る/作らない) は pim/plan.ts。ここは Graph の入出力のみ。

const GRAPH = "https://graph.microsoft.com/v1.0";
const LIST_NAME = "YOROZU";
const LIST_META = "pim.todolist.id";

async function getToken(): Promise<string> {
  const t = await msAccessToken(false);
  if (!t) throw new Error("Microsoft にサインインしていません");
  return t;
}

function tz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function graphJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Graph todo ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** 専用リスト「YOROZU」の id を得る (無ければ作る)。id は meta にキャッシュ */
async function ensureListId(): Promise<string> {
  const cached = await getMeta<string>(db, LIST_META);
  if (cached) return cached;
  const lists = await graphJson<{
    value: Array<{ id: string; displayName: string }>;
  }>("/me/todo/lists?$top=100");
  let id = lists.value.find((l) => l.displayName === LIST_NAME)?.id;
  if (!id) {
    const created = await graphJson<{ id: string }>("/me/todo/lists", {
      method: "POST",
      body: JSON.stringify({ displayName: LIST_NAME }),
    });
    id = created.id;
    dlog("todo", `リスト ${LIST_NAME} を作成`);
  }
  await setMeta(db, LIST_META, id);
  return id;
}

export class TodoPimProvider implements PimProvider {
  readonly kind = "todo";

  async listExistingKeys(): Promise<Set<string>> {
    const listId = await ensureListId();
    const tasks = await graphJson<{
      value: Array<{ body?: { content?: string } }>;
    }>(`/me/todo/lists/${listId}/tasks?$top=200`);
    const keys = new Set<string>();
    for (const t of tasks.value) {
      const k = extractKey(t.body?.content ?? "");
      if (k) keys.add(k);
    }
    dlog("todo", `existing keys=${keys.size}`);
    return keys;
  }

  async createEntries(occurrences: readonly Occurrence[]): Promise<void> {
    const listId = await ensureListId();
    for (const o of occurrences) {
      await graphJson(`/me/todo/lists/${listId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: o.label,
          body: { content: bodyWithKey(o.key), contentType: "text" },
          dueDateTime: { dateTime: `${o.at}:00`, timeZone: tz() },
          reminderDateTime: { dateTime: `${o.at}:00`, timeZone: tz() },
          isReminderOn: true,
        }),
      });
    }
    if (occurrences.length > 0) {
      dlog("todo", `created ${occurrences.length} tasks`);
    }
  }
}
