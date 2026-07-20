import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser";

// OAuth (PKCE) Spike — 設計書 §8 W0 / §10-0。
// ブラウザ完結・クライアントシークレット無し。トークンは MSAL が
// localStorage にキャッシュし、再起動後も acquireTokenSilent で維持される。
// msal-browser は動的 import してメインバンドルを太らせない。

// Entra ID アプリ登録 (Issue #15)。client ID は公開識別子で secret ではない。
export const MSAL_CLIENT_ID = "97700502-bead-4283-b1f1-324c6bf0efd7";

// 個人 Microsoft アカウント専用 (設計書 §7: 職場テナント混用の回避)
const AUTHORITY = "https://login.microsoftonline.com/consumers";

// スコープ最小 (設計書 §1)。将来の #16/#17 も同じ同意で賄う
export const GRAPH_SCOPES = [
  "Files.ReadWrite.AppFolder",
  "Calendars.ReadWrite",
  "Tasks.ReadWrite",
];

let initPromise: Promise<PublicClientApplication> | null = null;

function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/** MSAL 初期化 + リダイレクト戻りの処理 (アプリ起動時に一度呼ぶ) */
export function ensureMsal(): Promise<PublicClientApplication> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { PublicClientApplication } = await import("@azure/msal-browser");
    const pca = new PublicClientApplication({
      auth: {
        clientId: MSAL_CLIENT_ID,
        authority: AUTHORITY,
        redirectUri: redirectUri(),
        postLogoutRedirectUri: redirectUri(),
      },
      cache: { cacheLocation: "localStorage" },
    });
    await pca.initialize();
    const result = await pca.handleRedirectPromise();
    if (result?.account) pca.setActiveAccount(result.account);
    return pca;
  })();
  return initPromise;
}

export async function msAccount(): Promise<AccountInfo | null> {
  const pca = await ensureMsal();
  return pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
}

/** iOS PWA/Safari を考慮しリダイレクト方式 (設計書 §9 のリスク対象そのもの) */
export async function msSignIn(): Promise<void> {
  const pca = await ensureMsal();
  await pca.loginRedirect({ scopes: GRAPH_SCOPES, prompt: "select_account" });
}

export async function msSignOut(): Promise<void> {
  const pca = await ensureMsal();
  await pca.logoutRedirect();
}

/** アクセストークン取得。サイレント失敗時はリダイレクトで再認証 */
export async function msAccessToken(): Promise<string | null> {
  const pca = await ensureMsal();
  const account = await msAccount();
  if (!account) return null;
  try {
    const r = await pca.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
    return r.accessToken;
  } catch {
    await pca.acquireTokenRedirect({ scopes: GRAPH_SCOPES, account });
    return null; // リダイレクトで戻ってくる
  }
}

/** msal-browser を読み込まずに「MSALを使った形跡があるか」を判定 (起動コスト節約) */
export function msLikelySignedIn(): boolean {
  return Object.keys(localStorage).some((k) => k.startsWith("msal."));
}
