// BYOK: キーは利用者自身のもので、この端末の localStorage にのみ保存する (設計書 §5)。
// XSS 面は厳格 CSP + 外部スクリプト 0 で潰す方針。

const KEY = "yorozu.anthropic_key";

export function getApiKey(): string | null {
  return localStorage.getItem(KEY);
}

export function setApiKey(key: string): void {
  if (key.trim() === "") {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, key.trim());
  }
}

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}

export const KEY_CONSENT_TEXT =
  "APIキーはこの端末のブラウザ (localStorage) にのみ保存され、Anthropic API との通信以外には送信されません。" +
  "共有端末では保存しないでください。キー欄を空にして保存すると削除されます。";
