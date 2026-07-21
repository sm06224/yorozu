import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import type { Occurrence } from "../core";
import { db } from "../db/db";
import type { PimProvider } from "./provider";
import { pimUpsert, pimWriteAll, splitForTodo } from "./sync";

// 2回の upsert をまたいだ reconcile: PIM 側で消されたものを再作成しないこと。

function occ(at: string, id = "item"): Occurrence {
  return {
    key: `${id}:rule:${at}`,
    item_id: id,
    rule_id: "rule",
    kind: "deadline",
    at,
    label: "テスト",
  };
}

class FakePim implements PimProvider {
  readonly kind = "fake";
  store = new Set<string>();
  created: string[] = [];

  async listExistingKeys(): Promise<Set<string>> {
    return new Set(this.store);
  }

  async createEntries(occurrences: readonly Occurrence[]): Promise<void> {
    for (const o of occurrences) {
      this.store.add(o.key);
      this.created.push(o.key);
    }
  }
}

const NOW = "2026-07-20T09:00";

beforeEach(async () => {
  await db.meta.clear();
});

describe("pimUpsert reconcile", () => {
  test("初回は全作成、2回目は全スキップ", async () => {
    const pim = new FakePim();
    const occs = [occ("2026-07-21T09:00"), occ("2026-07-22T09:00")];
    const r1 = await pimUpsert(pim, occs, NOW);
    expect(r1).toEqual({ created: 2, skipped: 0, respected: 0 });
    const r2 = await pimUpsert(pim, occs, NOW);
    expect(r2).toEqual({ created: 0, skipped: 2, respected: 0 });
  });

  test("PIM 側で削除されたエントリは再作成しない (PIM が勝つ)", async () => {
    const pim = new FakePim();
    const a = occ("2026-07-21T09:00");
    const b = occ("2026-07-22T09:00");
    await pimUpsert(pim, [a, b], NOW);

    pim.store.delete(a.key); // ユーザーが Outlook 側で a を削除

    const r = await pimUpsert(pim, [a, b], NOW);
    expect(r).toEqual({ created: 0, skipped: 1, respected: 1 });
    expect(pim.store.has(a.key)).toBe(false); // 復活していない
  });

  test("新しい発火予定は削除尊重と独立に作成される", async () => {
    const pim = new FakePim();
    const a = occ("2026-07-21T09:00");
    await pimUpsert(pim, [a], NOW);
    pim.store.delete(a.key);

    const c = occ("2026-07-23T09:00", "item2");
    const r = await pimUpsert(pim, [a, c], NOW);
    expect(r).toEqual({ created: 1, skipped: 0, respected: 1 });
    expect(pim.created).toContain(c.key);
  });
});

describe("To Do 振り分け (#17)", () => {
  function kindOcc(kind: Occurrence["kind"], at: string): Occurrence {
    return { ...occ(at, `i-${kind}`), kind };
  }

  test("splitForTodo: reask/window → todo、deadline/brief → calendar", () => {
    const occs = [
      kindOcc("deadline", "2026-07-21T09:00"),
      kindOcc("reask", "2026-07-22T09:00"),
      kindOcc("window", "2026-07-23T09:00"),
      kindOcc("brief", "2026-07-24T07:30"),
    ];
    const s = splitForTodo(occs);
    expect(s.calendar.map((o) => o.kind)).toEqual(["deadline", "brief"]);
    expect(s.todo.map((o) => o.kind)).toEqual(["reask", "window"]);
  });

  test("pimWriteAll: todo プロバイダありなら振り分けて書き、記録は別々", async () => {
    const cal = new FakePim();
    const todo = new FakePim();
    Object.defineProperty(todo, "kind", { value: "fake-todo" });
    const occs = [
      kindOcc("deadline", "2026-07-21T09:00"),
      kindOcc("reask", "2026-07-22T09:00"),
    ];
    const r = await pimWriteAll(occs, NOW, { calendar: cal, todo });
    expect(r).toEqual({ created: 2, skipped: 0, respected: 0 });
    expect(cal.created).toHaveLength(1);
    expect(todo.created).toHaveLength(1);

    // 片方 (todo) でユーザーが削除 → todo 側だけ respected
    todo.store.clear();
    const r2 = await pimWriteAll(occs, NOW, { calendar: cal, todo });
    expect(r2).toEqual({ created: 0, skipped: 1, respected: 1 });
  });

  test("pimWriteAll: todo=null なら全部 calendar", async () => {
    const cal = new FakePim();
    const occs = [
      kindOcc("deadline", "2026-07-21T09:00"),
      kindOcc("reask", "2026-07-22T09:00"),
    ];
    const r = await pimWriteAll(occs, NOW, { calendar: cal, todo: null });
    expect(r.created).toBe(2);
    expect(cal.created).toHaveLength(2);
  });
});
