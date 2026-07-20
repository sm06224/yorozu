// 全画面スクリーンショット (ライト/ダーク両方)。/visual-check スキルから使う。
// 前提: pnpm build 済み + pnpm preview --port 4173 起動済み。
// 使い方: node scripts/shots.mjs [出力dir]
import { chromium } from "@playwright/test";

const dir = process.argv[2] ?? "shots-out";
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

for (const scheme of ["dark", "light"]) {
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("http://localhost:4173/");
  const cap = async (t) => {
    const i = page.getByPlaceholder("頭の中のものを放り込む…");
    await i.click();
    await i.pressSequentially(t);
    await i.press("Enter");
    await page.waitForTimeout(150);
  };
  await cap("牛乳を買う");
  await cap("請求書を支払う 8/1まで");
  await cap("旅行の計画を立てる");
  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${scheme}-${name}.png` });
  };
  await shot("1-inbox");
  await page.getByRole("button", { name: /トリアージ/ }).click();
  await shot("2-triage");
  const due = new Date();
  due.setDate(due.getDate() + 2);
  await page.locator('input[type="date"]').fill(due.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "今やる" }).click();
  await page.getByRole("button", { name: "いつか" }).click();
  await page.getByRole("button", { name: "待ち" }).click();
  await page.getByRole("button", { name: "予定" }).click();
  await shot("3-brief");
  await page.getByRole("button", { name: "一覧" }).click();
  await shot("4-list");
  await page.getByRole("button", { name: "設定" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${dir}/${scheme}-5-settings.png`,
    fullPage: true,
  });
  await page.close();
}
await b.close();
console.log(`done: ${dir}`);
