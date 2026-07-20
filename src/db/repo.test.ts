import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "./db";
import { applyTriage, captureItem, setStatus } from "./repo";

beforeEach(async () => {
  await db.items.clear();
  await db.rules.clear();
});

describe("repo", () => {
  test("captureItem が inbox にアイテムを作る", async () => {
    const item = await captureItem("  牛乳を買う  ");
    expect(item.title).toBe("牛乳を買う");
    expect(item.status).toBe("inbox");
    expect(await db.items.count()).toBe(1);
  });

  test("setStatus done で done_at が付き、戻すと消える", async () => {
    const item = await captureItem("x");
    await setStatus(item.id, "done");
    expect((await db.items.get(item.id))?.done_at).not.toBeNull();
    await setStatus(item.id, "inbox");
    expect((await db.items.get(item.id))?.done_at).toBeNull();
  });

  test("applyTriage が status/triaged_at/ルールを一括で確定する", async () => {
    const item = await captureItem("請求書を払う");
    await applyTriage(item.id, {
      status: "active",
      due: { date: "2026-08-01" },
      reask_days: 7,
      ai_allowed: false,
    });
    const saved = await db.items.get(item.id);
    expect(saved?.status).toBe("active");
    expect(saved?.triaged_at).not.toBeNull();
    expect(saved?.ai_allowed).toBe(false);

    const rules = await db.rules.where("item_id").equals(item.id).toArray();
    expect(rules.map((r) => r.kind).sort()).toEqual(["deadline", "reask"]);
    const deadline = rules.find((r) => r.kind === "deadline");
    expect(deadline?.kind === "deadline" && deadline.due).toBe(
      "2026-08-01T09:00",
    );
  });

  test("期日を動かしても当初期限 (original_due) を保持する", async () => {
    const item = await captureItem("x");
    await applyTriage(item.id, {
      status: "active",
      due: { date: "2026-08-01" },
    });
    await applyTriage(item.id, {
      status: "active",
      due: { date: "2026-08-10" },
    });
    const rule = (await db.rules.where("item_id").equals(item.id).toArray())[0];
    expect(rule?.kind === "deadline" && rule.due).toBe("2026-08-10T09:00");
    expect(rule?.kind === "deadline" && rule.original_due).toBe(
      "2026-08-01T09:00",
    );
  });

  test("applyTriage の再実行は既存ルールを置き換える", async () => {
    const item = await captureItem("x");
    await applyTriage(item.id, {
      status: "active",
      due: { date: "2026-08-01" },
    });
    await applyTriage(item.id, { status: "someday", reask_days: 30 });
    const rules = await db.rules.where("item_id").equals(item.id).toArray();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.kind).toBe("reask");
  });
});
