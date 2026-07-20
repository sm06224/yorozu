// テキスト1ファイル型アダプタ (fsa/onedrive) の journal 表現 (#25 compaction)。
// 切り詰め後は先頭にヘッダ行 `{"yorozu_journal_base":N}` を置き、
// グローバル行番号 = N + ファイル内エントリ行番号 を保つ。
// ヘッダが無いファイル (既存リモート) は base 0 として後方互換。

const BASE_KEY = "yorozu_journal_base";

export interface ParsedJournal {
  base: number;
  lines: string[];
}

export function parseJournalText(text: string | null): ParsedJournal {
  if (!text) return { base: 0, lines: [] };
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const first = lines[0];
  if (first?.includes(BASE_KEY)) {
    try {
      const parsed = JSON.parse(first) as Record<string, unknown>;
      const base = parsed[BASE_KEY];
      if (typeof base === "number" && Number.isInteger(base) && base >= 0) {
        return { base, lines: lines.slice(1) };
      }
    } catch {
      // ヘッダ風だが壊れている → 通常行として扱う (parseEntry 側でスキップされる)
    }
  }
  return { base: 0, lines };
}

export function serializeJournalText(base: number, lines: string[]): string {
  const header = base > 0 ? [`{"${BASE_KEY}":${base}}`] : [];
  const all = [...header, ...lines];
  return all.length > 0 ? `${all.join("\n")}\n` : "";
}
