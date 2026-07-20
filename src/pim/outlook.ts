import type { Occurrence } from "../core";
import { toDate, toLocalDateTime } from "../core";
import { msAccessToken } from "./msal";
import { bodyWithKey, extractKey, type PimProvider } from "./provider";

// Graph (Outlook カレンダー) アダプタ (設計書 §2, #17)。
// brief/deadline/reask/window すべてをカレンダーイベントとして実体化する
// (To Do 分割は将来検討。まずはカレンダー一本で通知配達を成立させる)。
// 意思決定 (何を作る/作らない) は pim/plan.ts。ここは Graph の入出力のみ。

const GRAPH = "https://graph.microsoft.com/v1.0";

async function getToken(): Promise<string> {
  const t = await msAccessToken(false);
  if (!t) throw new Error("Microsoft にサインインしていません");
  return t;
}

function tz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function endOf(o: Occurrence): string {
  const d = toDate(o.at);
  d.setUTCMinutes(d.getUTCMinutes() + 15);
  return `${toLocalDateTime(d)}:00`;
}

export class OutlookPimProvider implements PimProvider {
  readonly kind = "outlook";

  async listExistingKeys(
    from: Occurrence["at"],
    to: Occurrence["at"],
  ): Promise<Set<string>> {
    const token = await getToken();
    const url =
      `${GRAPH}/me/calendarView?startDateTime=${from}:00&endDateTime=${to}:00` +
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

  async createEntries(occurrences: readonly Occurrence[]): Promise<void> {
    const token = await getToken();
    for (const o of occurrences) {
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
    }
  }
}
