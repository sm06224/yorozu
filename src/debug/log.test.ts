import { beforeEach, describe, expect, test } from "vitest";
import { clearLog, dlog, logText, readLog } from "./log";

beforeEach(() => clearLog());

describe("診断ログ", () => {
  test("書いた順に読める + テキスト形式", () => {
    dlog("sync", "start", { cursor: 3 });
    dlog("onedrive", "put ok");
    const entries = readLog();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.scope).toBe("sync");
    expect(entries[0]?.data).toBe('{"cursor":3}');
    expect(logText()).toMatch(
      /\[sync\] start \{"cursor":3\}\n.*\[onedrive\] put ok/,
    );
  });

  test("Error は name: message に整形される", () => {
    dlog("app", "失敗", new TypeError("Load failed"));
    expect(readLog()[0]?.data).toBe("TypeError: Load failed");
  });

  test("上限を超えた古い行は捨てられる", () => {
    for (let i = 0; i < 600; i += 1) dlog("t", `m${i}`);
    const entries = readLog();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.msg).toBe("m100");
  });

  test("クリアで空になる", () => {
    dlog("t", "x");
    clearLog();
    expect(readLog()).toHaveLength(0);
  });
});
