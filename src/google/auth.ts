import { dlog } from "../debug/log";

// Google OAuth (implicit flow, リダイレクト方式)。
// 公式 GIS スクリプトは外部スクリプト禁止 (厳格CSP, §5/§9) のため使えない。
// アクセストークンは URL フラグメントで受け取り localStorage に保持 (約1時間)。
// 期限切れは prompt=none のリダイレクトでサイレント更新する (シークレット不要)。
// client ID は公開識別子であり secret ではない。ユーザーが設定画面で入力する。

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const CLIENT_ID_KEY = "yorozu_g_client_id";
const TOKEN_KEY = "yorozu_g_token";
const STATE_KEY = "yorozu_g_state";

export interface GToken {
  access_token: string;
  /** epoch ms */
  expires_at: number;
}

export function getGoogleClientId(): string {
  return localStorage.getItem(CLIENT_ID_KEY) ?? "";
}

export function setGoogleClientId(id: string): void {
  if (id.trim()) localStorage.setItem(CLIENT_ID_KEY, id.trim());
  else localStorage.removeItem(CLIENT_ID_KEY);
}

function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/** 認可 URL を組み立てる (純粋: テスト対象) */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  silent: boolean;
}): string {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "token",
    scope: GOOGLE_SCOPES,
    include_granted_scopes: "true",
    state: opts.state,
    prompt: opts.silent ? "none" : "select_account",
  });
  return `${AUTH_URL}?${p.toString()}`;
}

/**
 * リダイレクト戻りのフラグメントを解釈する (純粋: テスト対象)。
 * トークンが無い/state 不一致なら null
 */
export function parseCallback(
  hash: string,
  expectedState: string | null,
  nowMs: number,
): GToken | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const token = p.get("access_token");
  const expiresIn = Number(p.get("expires_in") ?? "0");
  const state = p.get("state");
  if (!token || !expiresIn) return null;
  if (expectedState && state !== expectedState) return null;
  // 期限は1分の余裕を見て短めに扱う
  return { access_token: token, expires_at: nowMs + (expiresIn - 60) * 1000 };
}

function readToken(): GToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as GToken) : null;
  } catch {
    return null;
  }
}

export function gSignedIn(): boolean {
  return readToken() !== null;
}

/** サインイン (アカウント選択画面へリダイレクト) */
export function gSignIn(): void {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error("Google クライアント ID が未設定です");
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  window.location.assign(
    buildAuthUrl({
      clientId,
      redirectUri: redirectUri(),
      state,
      silent: false,
    }),
  );
}

export function gSignOut(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** アプリ起動時に一度呼ぶ: リダイレクト戻りならトークンを保存して URL を掃除 */
export function gHandleRedirect(): void {
  if (!window.location.hash.includes("access_token=")) return;
  const token = parseCallback(
    window.location.hash,
    sessionStorage.getItem(STATE_KEY),
    Date.now(),
  );
  sessionStorage.removeItem(STATE_KEY);
  if (token) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    dlog(
      "gauth",
      `redirect 戻り: token 取得 (expires ${new Date(token.expires_at).toISOString()})`,
    );
  } else {
    dlog("gauth", "redirect 戻り: token 取得失敗 (state 不一致 or error)");
  }
  // フラグメントからトークンを消す (履歴にも残さない)
  window.history.replaceState(null, "", window.location.pathname);
}

/**
 * アクセストークン取得。期限内ならそれを返す。
 * 切れている場合: interactive=true なら prompt=none リダイレクトで更新を試みる
 * (Google セッションが生きていれば UI なしで戻ってくる)。false なら null。
 */
export function gAccessToken(interactive: boolean): string | null {
  const t = readToken();
  if (t && t.expires_at > Date.now()) return t.access_token;
  if (t && interactive) {
    const clientId = getGoogleClientId();
    if (!clientId) return null;
    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    dlog("gauth", "token 期限切れ: prompt=none で更新リダイレクト");
    window.location.assign(
      buildAuthUrl({
        clientId,
        redirectUri: redirectUri(),
        state,
        silent: true,
      }),
    );
  }
  if (!t) dlog("gauth", "未サインイン");
  else if (!interactive) dlog("gauth", "token 期限切れ (silent なので諦め)");
  return null;
}
