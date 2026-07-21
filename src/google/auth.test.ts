import { describe, expect, test } from "vitest";
import { buildAuthUrl, GOOGLE_SCOPES, parseCallback } from "./auth";

describe("Google OAuth (implicit/redirect)", () => {
  test("認可 URL: 必須パラメータが入る", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "abc.apps.googleusercontent.com",
        redirectUri: "https://example.com/yorozu/",
        state: "st1",
        silent: false,
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe(
      "abc.apps.googleusercontent.com",
    );
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("state")).toBe("st1");
  });

  test("silent は prompt=none", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "c",
        redirectUri: "https://x/",
        state: "s",
        silent: true,
      }),
    );
    expect(url.searchParams.get("prompt")).toBe("none");
  });

  test("コールバック解釈: token と期限 (60秒の余裕)", () => {
    const t = parseCallback(
      "#access_token=tok123&expires_in=3600&state=st1&token_type=Bearer",
      "st1",
      1_000_000,
    );
    expect(t?.access_token).toBe("tok123");
    expect(t?.expires_at).toBe(1_000_000 + 3540 * 1000);
  });

  test("state 不一致 / token 無しは null", () => {
    expect(
      parseCallback("#access_token=t&expires_in=3600&state=evil", "st1", 0),
    ).toBeNull();
    expect(
      parseCallback("#error=access_denied&state=st1", "st1", 0),
    ).toBeNull();
  });
});
