import { describe, expect, test } from "vitest";
import { bodyWithKey, extractKey } from "./provider";

describe("pim/provider", () => {
  test("bodyWithKey → extractKey が往復する", () => {
    const key = "item1:rule1:2026-07-24T09:00";
    expect(extractKey(bodyWithKey(key))).toBe(key);
  });

  test("HTML本文に埋まったキーも取り出せる", () => {
    expect(extractKey("<p>yorozu-key:a:b:2026-01-01T09:00</p>")).toBe(
      "a:b:2026-01-01T09:00",
    );
  });

  test("キーが無ければ null", () => {
    expect(extractKey("ただのメモ")).toBeNull();
  });
});
