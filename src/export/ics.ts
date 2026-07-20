import type { LocalDateTime, Occurrence } from "../core";

// ICS 書き出し (設計書 §10-5, §10-10)。役割はバックアップ/相互運用。
// Occurrence は既に決定論で展開済みなので RRULE ではなく個別 VEVENT で出す。
// UID には冪等キー (item:rule:at) をそのまま使い、再出力・再取込しても重複しない。

function icsDateTime(dt: LocalDateTime): string {
  // ローカル表記 (フローティングタイム)。TZ の解釈は取り込み側カレンダーに委ねる
  const [date = "", time = "00:00"] = dt.split("T");
  const [hh = "00", mm = "00"] = time.split(":");
  return `${date.replaceAll("-", "")}T${hh}${mm}00`;
}

function escapeText(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

/** RFC 5545: 行は75オクテットで折り返す (継続行は先頭スペース) */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  const limit = () => (out.length === 0 ? 75 : 74);
  for (const ch of line) {
    const chLen = new TextEncoder().encode(ch).length;
    if (curLen + chLen > limit()) {
      out.push(cur);
      cur = ch;
      curLen = chLen;
    } else {
      cur += ch;
      curLen += chLen;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

/**
 * 発火予定を ICS (VCALENDAR) 文字列にする。
 * `generatedAt` を渡すと DTSTAMP が固定され、出力は完全に決定論になる。
 */
export function occurrencesToIcs(
  occurrences: readonly Occurrence[],
  generatedAt: LocalDateTime,
): string {
  const stamp = icsDateTime(generatedAt);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//yorozu//JP",
    "CALSCALE:GREGORIAN",
  ];
  for (const o of occurrences) {
    lines.push(
      "BEGIN:VEVENT",
      foldLine(`UID:${escapeText(o.key)}@yorozu`),
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(o.at)}`,
      foldLine(`SUMMARY:${escapeText(o.label)}`),
      foldLine(`CATEGORIES:${o.kind.toUpperCase()}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
