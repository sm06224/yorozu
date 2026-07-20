import { expect, test } from "@playwright/test";

// スモークテスト: キャプチャ → トリアージ → ブリーフ → 同期(IDB) → 永続性
// 本番ビルド (厳格CSP入り) に対して一連の主要フローが通ることを確認する。

test.describe.configure({ mode: "serial" });

test("キャプチャ → トリアージ → ブリーフ → 同期 → リロード永続", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "YOROZU" })).toBeVisible();

  // 1. キャプチャ
  await page.getByPlaceholder("頭の中のものを放り込む…").fill("牛乳を買う");
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("牛乳を買う")).toBeVisible();

  await page.getByPlaceholder("頭の中のものを放り込む…").fill("請求書を払う");
  await page.getByRole("button", { name: "追加" }).click();

  // 2. トリアージ: 1件目に期日を付けて「今やる」
  await page.getByRole("button", { name: /トリアージ/ }).click();
  await expect(page.getByText("残り 2 件")).toBeVisible();
  const due = new Date();
  due.setDate(due.getDate() + 3);
  const dueStr = due.toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(dueStr);
  await page.getByRole("button", { name: "今やる" }).click();
  await expect(page.getByText("残り 1 件")).toBeVisible();

  // 2件目は「いつか」+ 再確認1週間
  await page.locator("select").first().selectOption("7");
  await page.getByRole("button", { name: "いつか" }).click();
  await expect(page.getByText("トリアージ完了")).toBeVisible();

  // 3. ブリーフに発火予定が現れる
  await page.getByRole("button", { name: "予定" }).click();
  // 新表記: ⏰ +2D 牛乳を買う (「締切」の文言は書かない)
  await expect(
    page.locator(".item-row", { hasText: "牛乳を買う" }).first(),
  ).toBeVisible();
  await expect(page.locator(".brief-delta").first()).toHaveText(
    /^[+-]\d+[DH]$/,
  );
  // 再確認(1週間後)の初回発火は7日目 = 7日間先読みの外なのでここには出ない (仕様どおり)
  await expect(
    page.getByRole("button", { name: /予定表に送る/ }),
  ).toBeEnabled();

  // 4. 同期 (ブラウザ内IDBリモート)
  await page.getByRole("button", { name: "設定" }).click();
  await page.locator("select").selectOption("idb");
  await page.getByRole("button", { name: "今すぐ同期" }).click();
  await expect(page.getByText(/同期完了/)).toBeVisible();

  // 5. リロードしても残っている (ローカル正 + PWA)
  await page.reload();
  await page.getByRole("button", { name: "一覧" }).click();
  await expect(page.getByText("牛乳を買う")).toBeVisible();
  await expect(page.getByText("請求書を払う")).toBeVisible();

  // 6. 週次レビュー xlsx が生成・ダウンロードされる (CSP 下で動くことの実証)
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /週次レビュー/ }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^yorozu-review-\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
  await expect(page.getByText(/書き出し完了/)).toBeVisible();
});

test("再トリアージ導線: 一覧の↩ → 期日設定 → 予定に発火予定が出る", async ({
  page,
}) => {
  await page.goto("/");
  // 期日なしでトリアージ済みのアイテムを作る
  await page.getByPlaceholder("頭の中のものを放り込む…").fill("後から期日");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("button", { name: /トリアージ/ }).click();
  await page.getByRole("button", { name: "今やる" }).click();
  await expect(page.getByText("トリアージ完了")).toBeVisible();

  // 一覧 → ↩ で受信箱に戻す
  await page.getByRole("button", { name: "一覧" }).click();
  const row = page.locator(".item-row", { hasText: "後から期日" }).first();
  await row.getByTitle(/受信箱に戻して再トリアージ/).click();

  // 再トリアージで期日を設定
  await page.getByRole("button", { name: /トリアージ/ }).click();
  const due = new Date();
  due.setDate(due.getDate() + 2);
  await page.locator('input[type="date"]').fill(due.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "今やる" }).click();

  // 予定タブに発火予定が現れ、ICS ボタンが有効
  await page.getByRole("button", { name: "予定" }).click();
  await expect(
    page.locator(".item-row", { hasText: "後から期日" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /予定表に送る/ }),
  ).toBeEnabled();
});

test("添付: ファイルを付けると参照が残り、リロード後も開ける", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByPlaceholder("頭の中のものを放り込む…").fill("添付テスト");
  await page.getByRole("button", { name: "追加" }).click();

  const row = page.locator(".item-row", { hasText: "添付テスト" }).first();
  await row.getByTitle("添付ファイル").click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: Buffer.from("PNG-TEST-DATA"),
  });
  await expect(page.getByText(/shot\.png \(13B\)/)).toBeVisible();

  // リロードしても参照と blob (ローカルIDB) が残っている
  await page.reload();
  await page
    .locator(".item-row", { hasText: "添付テスト" })
    .first()
    .getByTitle("添付ファイル")
    .click();
  await expect(page.getByText(/shot\.png/)).toBeVisible();
});

test("CSP メタが本番HTMLに存在し外部スクリプトがない", async ({ page }) => {
  await page.goto("/");
  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  const content = await csp.getAttribute("content");
  expect(content).toContain("script-src 'self'");
  const externalScripts = await page.locator('script[src^="http"]').count();
  expect(externalScripts).toBe(0);
});
