import { describe, expect, test } from "vitest";
import type { Item, SurfaceRule } from "../core";
import { ItemSchema, SurfaceRuleSchema } from "../core";
import { buildWeeklyReview } from "./review";

const NOW = "2026-07-20T13:00";
const T = "2026-07-01T08:00";

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

describe("buildWeeklyReview", () => {
  test("直近7日の完了だけが完了シートに入る", () => {
    const items = [
      makeItem({
        id: "a",
        title: "今週やった",
        status: "done",
        done_at: "2026-07-18T10:00",
        estimate_minutes: 30,
      }),
      makeItem({
        id: "b",
        title: "先月やった",
        status: "done",
        done_at: "2026-06-01T10:00",
      }),
    ];
    const [done] = buildWeeklyReview(items, [], NOW);
    expect(done?.rows).toEqual([["今週やった", "2026-07-18T10:00", 30]]);
  });

  test("7日以上更新のない未完了が滞留シートに入る (経過日数つき)", () => {
    const items = [
      makeItem({ id: "a", title: "放置中", updated_at: "2026-07-05T08:00" }),
      makeItem({
        id: "b",
        title: "最近触った",
        updated_at: "2026-07-19T08:00",
      }),
      makeItem({
        id: "c",
        title: "完了は滞留でない",
        status: "done",
        updated_at: "2026-07-01T08:00",
        done_at: "2026-07-01T09:00",
      }),
    ];
    const [, stale] = buildWeeklyReview(items, [], NOW);
    expect(stale?.rows).toEqual([["進行", "放置中", "2026-07-05T08:00", 15]]);
  });

  test("直近7日の発火実績シート", () => {
    const item = makeItem({ id: "a", title: "締切もの" });
    const rule = SurfaceRuleSchema.parse({
      id: "r1",
      item_id: "a",
      kind: "deadline",
      due: "2026-07-18T09:00",
      lead_days: [0],
      original_due: null,
      enabled: true,
      created_at: T,
      updated_at: T,
    });
    const [, , fired] = buildWeeklyReview([item], [rule as SurfaceRule], NOW);
    expect(fired?.rows.some((r) => r[1] === "締切")).toBe(true);
  });
});
