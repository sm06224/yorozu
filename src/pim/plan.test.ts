import { describe, expect, test } from "vitest";
import type { Occurrence } from "../core";
import { keyAt, planUpsert, pruneWrittenKeys } from "./plan";

function occ(key: string, at: string): Occurrence {
  return { key, at, kind: "deadline", item_id: "i", rule_id: "r", label: "x" };
}

const A = occ("i:r:2026-07-21T09:00", "2026-07-21T09:00");
const B = occ("i:r:2026-07-22T09:00", "2026-07-22T09:00");
const C = occ("i:r:2026-07-23T09:00", "2026-07-23T09:00");

describe("planUpsert (PIM が勝つ)", () => {
  test("既存はスキップ・未書き込みは作成", () => {
    const p = planUpsert([A, B], new Set([A.key]), new Set());
    expect(p.skippedExisting).toBe(1);
    expect(p.toCreate).toEqual([B]);
    expect(p.respectedDeleted).toBe(0);
  });

  test("書いた記録があるのに PIM に無い → 再作成しない", () => {
    const p = planUpsert([A, B, C], new Set([B.key]), new Set([A.key, B.key]));
    expect(p.respectedDeleted).toBe(1); // A はユーザーが消した
    expect(p.skippedExisting).toBe(1); // B は残っている
    expect(p.toCreate).toEqual([C]); // C だけ新規
  });

  test("全部初回なら全部作成", () => {
    const p = planUpsert([A, B], new Set(), new Set());
    expect(p.toCreate).toEqual([A, B]);
  });
});

describe("pruneWrittenKeys", () => {
  test("今日より前の記録だけ落ちる", () => {
    const keys = [
      "i:r:2026-07-19T09:00",
      "i:r:2026-07-20T00:00",
      "i:r:2026-07-21T09:00",
    ];
    expect(pruneWrittenKeys(keys, "2026-07-20T13:00")).toEqual([
      "i:r:2026-07-20T00:00",
      "i:r:2026-07-21T09:00",
    ]);
  });

  test("keyAt は uuid 入りキーでも at を取り出せる", () => {
    const key =
      "0b0e5f6a-1111-2222-3333-444455556666:aaaabbbb-cccc-dddd-eeee-ffff00001111:2026-07-21T09:00";
    expect(keyAt(key)).toBe("2026-07-21T09:00");
  });
});
