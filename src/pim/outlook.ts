import type { Occurrence } from "../core";
import { toDate, toLocalDateTime } from "../core";
import { msAccessToken } from "./msal";
import {
  bodyWithKey,
  extractKey,
  type PimProvider,
  type UpsertResult,
} from "./provider";

// Graph (Outlook カレンダー) アダプタ (設計書 §2, #17)。
// brief/deadline/reask/window すべてをカレンダーイベントとして実体化する
// (To Do 分割は将来検討。まずはカレンダー一本で通知配達を成立させる)。
// 冪等 upsert: 対象期間のイベントを列挙し、本文の yorozu-key で突合して無いものだけ作る。

const GRAPH = "https://graph.microsoft.com/v1.0";

async function getToken(): Promise<string> {
  const t = await msAccessToken(false);
  if (!t) throw new Error("Microsoft にサインインしていません");
  return t;
}

function tz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 既存の yorozu 生成イベントのキー集合を対象期間から収集 */
async function existingKeys(
  fromIso: string,
  toIso: string,
): Promise<Set<string>> {
  const token = await getToken();
  const url =
    `${GRAPH}/me/calendarView?startDateTime=${fromIso}&endDateTime=${toIso}` +
    `&$top=200&$select=body,bodyPreview`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: `outlook.timezone="${tz()}"`,
    },
  });
  if (!res.ok) throw new Error(`Graph calendarView ${res.status}`);
  const data = (await res.json()) as {
    value: Array<{ body?: { content?: string }; bodyPreview?: string }>;
  };
  const keys = new Set<string>();
  for (const ev of data.value) {
    const k =
      extractKey(ev.body?.content ?? "") ?? extractKey(ev.bodyPreview ?? "");
    if (k) keys.add(k);
  }
  return keys;
}

function endOf(o: Occurrence): string {
  const d = toDate(o.at);
  d.setUTCMinutes(d.getUTCMinutes() + 15);
  return `${toLocalDateTime(d)}:00`;
}

export class OutlookPimProvider implements PimProvider {
  readonly kind = "outlook";

  async upsertOccurrences(
    occurrences: readonly Occurrence[],
  ): Promise<UpsertResult> {
    if (occurrences.length === 0) return { created: 0, skipped: 0, notes: [] };
    const sorted = [...occurrences].sort((a, b) => a.at.localeCompare(b.at));
    const first = sorted[0]?.at ?? "";
    const last = sorted[sorted.length - 1]?.at ?? "";
    const have = await existingKeys(
      `${first}:00`,
      `${endOf(sorted[sorted.length - 1] as Occurrence)}`,
    );
    void last;

    const token = await getToken();
    let created = 0;
    let skipped = 0;
    for (const o of sorted) {
      if (have.has(o.key)) {
        skipped += 1;
        continue;
      }
      const res = await fetch(`${GRAPH}/me/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: o.label,
          body: { contentType: "text", content: bodyWithKey(o.key) },
          start: { dateTime: `${o.at}:00`, timeZone: tz() },
          end: { dateTime: endOf(o), timeZone: tz() },
          isReminderOn: true,
          reminderMinutesBeforeStart: 0,
        }),
      });
      if (!res.ok) {
        throw new Error(
          `Graph events ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
      created += 1;
    }
    return { created, skipped, notes: [] };
  }
}
