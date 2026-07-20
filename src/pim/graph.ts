import { addDays, dateOf, type LocalDateTime } from "../core";

// Graph API 呼び出し (Spike: カレンダーへイベント1件書き込み)。
// 本実装 (#16/#17) では StorageProvider / PimProvider の背後に置く (§12.3)。

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface GraphEvent {
  subject: string;
  body: { contentType: "text"; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

/** 純関数 (テスト対象): 接続テスト用イベントの本文を作る */
export function buildTestEvent(
  now: LocalDateTime,
  timeZone: string,
): GraphEvent {
  const date = dateOf(now);
  const tomorrow = addDays(date, 1);
  return {
    subject: "✅ YOROZU 接続テスト",
    body: {
      contentType: "text",
      content:
        "YOROZU の OAuth (PKCE) Spike による書き込みテストです。削除して構いません。\nitem_id: spike-test",
    },
    start: { dateTime: `${tomorrow}T09:00:00`, timeZone },
    end: { dateTime: `${tomorrow}T09:15:00`, timeZone },
  };
}

export async function createCalendarEvent(
  accessToken: string,
  event: GraphEvent,
): Promise<{ id: string; webLink?: string }> {
  const res = await fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as { id: string; webLink?: string };
}
