import { describe, expect, test } from "vitest";
import { parseJournalText, serializeJournalText } from "./textjournal";

describe("textjournal (base ヘッダ)", () => {
  test("ヘッダなし (既存形式) は base 0", () => {
    const j = parseJournalText('{"op":"x"}\n{"op":"y"}\n');
    expect(j.base).toBe(0);
    expect(j.lines).toHaveLength(2);
  });

  test("null/空文字は空 journal", () => {
    expect(parseJournalText(null)).toEqual({ base: 0, lines: [] });
    expect(parseJournalText("")).toEqual({ base: 0, lines: [] });
  });

  test("roundtrip: base 付きで直列化 → 復元", () => {
    const text = serializeJournalText(250, ['{"op":"a"}', '{"op":"b"}']);
    const j = parseJournalText(text);
    expect(j.base).toBe(250);
    expect(j.lines).toEqual(['{"op":"a"}', '{"op":"b"}']);
  });

  test("base 0 の直列化はヘッダを書かない (後方互換)", () => {
    const text = serializeJournalText(0, ['{"op":"a"}']);
    expect(text).toBe('{"op":"a"}\n');
  });

  test("壊れたヘッダ風の行は通常行として温存する", () => {
    const j = parseJournalText('{"yorozu_journal_base":oops}\n{"op":"a"}\n');
    expect(j.base).toBe(0);
    expect(j.lines).toHaveLength(2);
  });
});
