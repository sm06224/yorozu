import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// WCAG 1.4.3 (AA 4.5:1) / 1.4.11 (3:1) をパレットに対して強制する。
// ユーザーは低コントラストを識別できないため、この基準は下げない (上げるのは可)。

const css = readFileSync("src/index.css", "utf8");

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

const lightIdx = css.indexOf("@media (prefers-color-scheme: light)");
const dark = vars(css.slice(0, lightIdx));
const lightBlock = css.slice(lightIdx);
const light = vars(lightBlock.slice(0, lightBlock.indexOf("}\n}") + 3));

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["fg", "bg"],
  ["fg", "bg-raised"],
  ["fg", "bg-alt"],
  ["fg-muted", "bg"],
  ["fg-muted", "bg-raised"],
  ["accent", "bg"],
  ["accent", "bg-raised"],
  ["danger", "bg"],
  ["danger", "bg-raised"],
  ["ok", "bg-raised"],
  ["on-accent", "accent"],
  ["on-accent-strong", "accent-strong"],
];

for (const [name, palette] of [
  ["dark", dark],
  ["light", light],
] as const) {
  describe(`${name} パレット`, () => {
    test("必須の色が定義されている", () => {
      for (const k of [
        "bg",
        "bg-raised",
        "fg",
        "fg-muted",
        "accent",
        "border",
      ]) {
        expect(palette[k], k).toBeDefined();
      }
    });

    for (const [a, b] of TEXT_PAIRS) {
      test(`文字 ${a} on ${b} >= 4.5:1 (AA)`, () => {
        const r = ratio(palette[a] as string, palette[b] as string);
        expect(
          r,
          `${palette[a]} on ${palette[b]} = ${r.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    test("枠線 border on bg >= 3:1 (非テキスト)", () => {
      const r = ratio(palette.border as string, palette.bg as string);
      expect(r, `${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    });
  });
}
