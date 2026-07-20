import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { addDays, diffDays } from "./dates";
import {
  computeOccurrences,
  DEFAULT_REMIND_HOUR,
  type Horizon,
} from "./occurrences";
import type { Item, SurfaceRule } from "./types";
import { ItemSchema, SurfaceRuleSchema } from "./types";

const T = "2026-07-20T08:00";

function makeItem(over: Partial<Item> = {}): Item {
  return ItemSchema.parse({
    id: "item1",
    space_id: null,
    title: "テスト項目",
    body: "",
    status: "active",
    tags: [],
    ai_allowed: true,
    created_at: T,
    updated_at: T,
    triaged_at: null,
    done_at: null,
    ...over,
  });
}

function makeRule(
  over: Partial<SurfaceRule> & { kind: SurfaceRule["kind"] },
): SurfaceRule {
  const base = {
    id: "rule1",
    item_id: "item1",
    enabled: true,
    created_at: T,
    updated_at: T,
  };
  switch (over.kind) {
    case "deadline":
      return SurfaceRuleSchema.parse({
        due: "2026-07-25T17:00",
        lead_days: [0],
        ...base,
        ...over,
      });
    case "reask":
      return SurfaceRuleSchema.parse({
        anchor: "2026-07-01",
        interval_days: 7,
        ...base,
        ...over,
      });
    case "window":
      return SurfaceRuleSchema.parse({
        start: "2026-07-21",
        end: "2026-07-24",
        ...base,
        ...over,
      });
    case "brief":
      return SurfaceRuleSchema.parse({ ...base, ...over });
  }
}

const H: Horizon = { from: "2026-07-20", days: 7, hour: DEFAULT_REMIND_HOUR };

describe("deadline", () => {
  test("lead_days [7,1,0] が期限に向けて3回発火する", () => {
    const rule = makeRule({
      kind: "deadline",
      due: "2026-07-25T17:00",
      lead_days: [7, 1, 0],
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    // lead 7 → 7/18 は horizon 前で落ちる。lead 1 → 7/24 09:00、lead 0 → 7/25 17:00 (期限時刻そのもの)
    expect(occ.map((o) => o.at)).toEqual([
      "2026-07-24T09:00",
      "2026-07-25T17:00",
    ]);
    expect(occ[1]?.label).toBe("締切: テスト項目");
  });

  test("重複した lead_days は1回に潰れる", () => {
    const rule = makeRule({
      kind: "deadline",
      due: "2026-07-22T12:00",
      lead_days: [1, 1, 1],
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    expect(occ).toHaveLength(1);
  });
});

describe("reask", () => {
  test("anchor から interval ごとに horizon 内で発火する", () => {
    const rule = makeRule({
      kind: "reask",
      anchor: "2026-07-01",
      interval_days: 7,
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    // 7/8, 7/15 は過去。7/22 のみ horizon 内 (7/20〜7/26)
    expect(occ.map((o) => o.at)).toEqual(["2026-07-22T09:00"]);
  });

  test("horizon 初日がちょうど発火日なら含む", () => {
    const rule = makeRule({
      kind: "reask",
      anchor: "2026-07-13",
      interval_days: 7,
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    expect(occ.map((o) => o.at)).toContain("2026-07-20T09:00");
  });

  test("anchor 当日は発火しない", () => {
    const rule = makeRule({
      kind: "reask",
      anchor: "2026-07-20",
      interval_days: 3,
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    expect(occ.map((o) => o.at)).toEqual([
      "2026-07-23T09:00",
      "2026-07-26T09:00",
    ]);
  });
});

describe("window", () => {
  test("開始日と終了前日に発火する", () => {
    const rule = makeRule({
      kind: "window",
      start: "2026-07-21",
      end: "2026-07-24",
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    expect(occ.map((o) => [o.at, o.label])).toEqual([
      ["2026-07-21T09:00", "開始: テスト項目"],
      ["2026-07-23T09:00", "明日終了: テスト項目"],
    ]);
  });

  test("1日ウィンドウは開始のみ", () => {
    const rule = makeRule({
      kind: "window",
      start: "2026-07-21",
      end: "2026-07-22",
    });
    const occ = computeOccurrences([makeItem()], [rule], H);
    expect(occ).toHaveLength(1);
  });
});

describe("brief", () => {
  test("horizon の毎日発火する", () => {
    const rule = makeRule({ kind: "brief" });
    const occ = computeOccurrences([makeItem()], [rule], H);
    expect(occ).toHaveLength(7);
    expect(occ[0]?.at).toBe("2026-07-20T09:00");
    expect(occ[6]?.at).toBe("2026-07-26T09:00");
  });
});

describe("フィルタ", () => {
  test("done/archived・無効ルール・孤児ルールは発火しない", () => {
    const rules = [
      makeRule({ kind: "brief", id: "r1", item_id: "done1" }),
      makeRule({ kind: "brief", id: "r2", enabled: false }),
      makeRule({ kind: "brief", id: "r3", item_id: "ghost" }),
    ];
    const items = [makeItem(), makeItem({ id: "done1", status: "done" })];
    expect(computeOccurrences(items, rules, H)).toHaveLength(0);
  });
});

// --- プロパティテスト (設計書 §10-4: 決定論パッカー) ---

const dateArb = fc
  .record({
    y: fc.integer({ min: 2024, max: 2030 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ y, m, d }) =>
      `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`,
  );

const ruleArb: fc.Arbitrary<SurfaceRule> = fc.oneof(
  fc
    .record({
      due: dateArb,
      leads: fc.array(fc.integer({ min: 0, max: 30 }), {
        minLength: 1,
        maxLength: 5,
      }),
    })
    .map(({ due, leads }) =>
      makeRule({ kind: "deadline", due: `${due}T17:00`, lead_days: leads }),
    ),
  fc
    .record({ anchor: dateArb, interval: fc.integer({ min: 1, max: 60 }) })
    .map(({ anchor, interval }) =>
      makeRule({ kind: "reask", anchor, interval_days: interval }),
    ),
  fc
    .record({ start: dateArb, len: fc.integer({ min: 1, max: 60 }) })
    .map(({ start, len }) =>
      makeRule({ kind: "window", start, end: addDays(start, len) }),
    ),
  fc.constant(makeRule({ kind: "brief" })),
);

const horizonArb: fc.Arbitrary<Horizon> = fc.record({
  from: dateArb,
  days: fc.integer({ min: 1, max: 30 }),
  hour: fc.integer({ min: 0, max: 23 }),
});

describe("プロパティ", () => {
  test("決定論: 同じ入力から常に同じ出力", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 10 }),
        horizonArb,
        (rules, h) => {
          const items = [makeItem()];
          expect(computeOccurrences(items, rules, h)).toEqual(
            computeOccurrences(items, rules, h),
          );
        },
      ),
    );
  });

  test("全発火が horizon 内に収まる", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 10 }),
        horizonArb,
        (rules, h) => {
          for (const o of computeOccurrences([makeItem()], rules, h)) {
            const d = diffDays(o.at.slice(0, 10), h.from);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThan(h.days);
          }
        },
      ),
    );
  });

  test("key は一意 (冪等 upsert の前提)", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 10 }),
        horizonArb,
        (rules, h) => {
          // ルール id を振り直して衝突を避ける (同一アイテムに複数ルール)
          const uniq = rules.map(
            (r, i) => ({ ...r, id: `r${i}` }) as SurfaceRule,
          );
          const occ = computeOccurrences([makeItem()], uniq, h);
          expect(new Set(occ.map((o) => o.key)).size).toBe(occ.length);
        },
      ),
    );
  });

  test("出力は at 昇順で安定", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 10 }),
        horizonArb,
        (rules, h) => {
          const occ = computeOccurrences([makeItem()], rules, h);
          for (let i = 1; i < occ.length; i += 1) {
            const prev = occ[i - 1];
            const cur = occ[i];
            if (!prev || !cur) continue;
            expect(prev.at <= cur.at).toBe(true);
          }
        },
      ),
    );
  });
});
