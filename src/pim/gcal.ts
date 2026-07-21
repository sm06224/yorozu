import type { Occurrence } from "../core";
import { addDays, dateOf, toDate, toLocalDateTime } from "../core";
import { dlog } from "../debug/log";
import { gAccessToken } from "../google/auth";
import { bodyWithKey, extractKey, type PimProvider } from "./provider";

// Google カレンダーアダプタ (#40)。締切/ブリーフ系をイベントとして冪等 upsert。
// 突合は description 内の yorozu-key (Outlook と同一プロトコル)。

const API = "https://www.googleapis.com/calendar/v3";

function getToken(): string {
  const t = gAccessToken(false);
  if (!t) throw new Error("Google にサインインしていません");
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

export class GcalPimProvider implements PimProvider {
  readonly kind = "gcal";

  async listExistingKeys(
    from: Occurrence["at"],
    to: Occurrence["at"],
  ): Promise<Set<string>> {
    // timeMin/Max は RFC3339 必須。ローカル表記の厳密なオフセット計算を避け、
    // 窓を UTC 表記で前後1日広げる (キーは完全一致比較なので過剰包含は無害)
    const timeMin = `${addDays(dateOf(from), -1)}T00:00:00Z`;
    const timeMax = `${addDays(dateOf(to), 1)}T23:59:59Z`;
    const res = await fetch(
      `${API}/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=250&fields=items(description)`,
      { headers: { Authorization: `Bearer ${getToken()}` } },
    );
    if (!res.ok)
      throw new Error(
        `GCal 一覧 ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const data = (await res.json()) as {
      items?: Array<{ description?: string }>;
    };
    const keys = new Set<string>();
    for (const ev of data.items ?? []) {
      const k = extractKey(ev.description ?? "");
      if (k) keys.add(k);
    }
    dlog("gcal", `existing keys=${keys.size}`);
    return keys;
  }

  async createEntries(occurrences: readonly Occurrence[]): Promise<void> {
    for (const o of occurrences) {
      const res = await fetch(`${API}/calendars/primary/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: o.label,
          description: bodyWithKey(o.key),
          start: { dateTime: `${o.at}:00`, timeZone: tz() },
          end: { dateTime: endOf(o), timeZone: tz() },
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: 0 }],
          },
        }),
      });
      if (!res.ok)
        throw new Error(
          `GCal 作成 ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
    }
    if (occurrences.length > 0)
      dlog("gcal", `created ${occurrences.length} events`);
  }
}
