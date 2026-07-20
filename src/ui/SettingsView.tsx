import { useEffect, useRef, useState } from "react";
import { getApiKey, KEY_CONSENT_TEXT, setApiKey } from "../ai/key";
import { wallClockNow } from "../core";
import { db } from "../db/db";
import { buildTestEvent, createCalendarEvent } from "../pim/graph";
import { msAccessToken, msAccount, msSignIn, msSignOut } from "../pim/msal";
import { isAutoPimEnabled, setAutoPimEnabled } from "../pim/sync";
import {
  getConfiguredProvider,
  getSyncKind,
  type SyncKind,
  saveFsaHandle,
  setSyncKind,
} from "../sync/config";
import { syncOnce } from "../sync/engine";
import { fsaSupported, pickSyncFolder } from "../sync/fsa";

export function SettingsView() {
  const [kind, setKind] = useState<SyncKind>("none");
  const [folderName, setFolderName] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyInput, setKeyInput] = useState(() => getApiKey() ?? "");
  const [keyStatus, setKeyStatus] = useState("");

  function saveKey() {
    setApiKey(keyInput);
    setKeyStatus(keyInput.trim() ? "キーを保存しました" : "キーを削除しました");
  }

  const [msUser, setMsUser] = useState<string | null>(null);
  const [msStatus, setMsStatus] = useState("");
  const [msBusy, setMsBusy] = useState(false);
  const [pimAuto, setPimAuto] = useState(() => isAutoPimEnabled());

  const kindTouched = useRef(false);

  useEffect(() => {
    // 初期読込がユーザー操作より遅れて解決した場合に選択を巻き戻さない
    void getSyncKind(db).then((k) => {
      if (!kindTouched.current) setKind(k);
    });
    // 常に MSAL に問い合わせる (リダイレクト戻り処理の完了を ensureMsal 経由で待つ)。
    // マウント時のヒューリスティック判定だけだと、サインインから戻った直後に
    // 「サインイン中」表示へ切り替わらないバグがあった (Issue #15)
    void msAccount()
      .then((a) => setMsUser(a?.username ?? null))
      .catch(() => setMsUser(null));
  }, []);

  async function msTestWrite() {
    setMsBusy(true);
    setMsStatus("Graph へ書き込み中…");
    try {
      const token = await msAccessToken();
      if (!token) {
        setMsStatus("トークン取得のため再認証にリダイレクトします…");
        return;
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await createCalendarEvent(
        token,
        buildTestEvent(wallClockNow(), tz),
      );
      setMsStatus(
        `✅ 書き込み成功 (event id: ${r.id.slice(0, 12)}…)。Outlook の明日9:00を確認してください`,
      );
    } catch (e) {
      setMsStatus(`❌ 失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMsBusy(false);
    }
  }

  async function changeKind(next: SyncKind) {
    kindTouched.current = true;
    setKind(next);
    await setSyncKind(db, next);
    setStatus("");
  }

  async function chooseFolder() {
    const handle = await pickSyncFolder();
    if (!handle) return;
    await saveFsaHandle(db, handle);
    setFolderName(handle.name);
    setStatus(`フォルダ「${handle.name}」を保存しました`);
  }

  async function syncNow() {
    setBusy(true);
    setStatus("同期中…");
    try {
      const provider = await getConfiguredProvider(db, true);
      if (!provider) {
        setStatus("同期先が未設定です (FSAはフォルダ選択と権限が必要)");
        return;
      }
      const r = await syncOnce(db, provider);
      setStatus(
        `同期完了: 取込 ${r.pulled} 行 / 適用 ${r.applied} 件 / 送信 ${r.pushed} 件`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Safari は fetch のネットワーク失敗を "Load failed" とだけ言う
      const hint = /load failed|failed to fetch/i.test(msg)
        ? " (ネットワーク不達。電波状況と Microsoft サインイン状態を確認して、もう一度お試しください)"
        : "";
      setStatus(`同期エラー: ${msg}${hint}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings">
      <h2>同期・バックアップ</h2>
      <p className="hint">
        app 専用フォルダに journal.jsonl (変更ログ) と snapshot.json を書き、
        それがそのままバックアップになります。OneDrive/Google Drive
        アダプタは今後追加。
      </p>
      <label className="field">
        <span>同期先</span>
        <select
          value={kind}
          onChange={(e) => void changeKind(e.target.value as SyncKind)}
        >
          <option value="none">なし</option>
          <option value="idb">このブラウザ (IndexedDB / 動作確認用)</option>
          <option value="onedrive">
            OneDrive (approot / 要 Microsoft サインイン)
          </option>
          <option value="fsa" disabled={!fsaSupported()}>
            フォルダ (File System Access
            {fsaSupported() ? "" : " / このブラウザ非対応"})
          </option>
        </select>
      </label>
      {kind === "fsa" && (
        <div className="field">
          <button
            type="button"
            className="btn"
            onClick={() => void chooseFolder()}
          >
            フォルダを選ぶ…
          </button>
          {folderName && <span className="hint">選択中: {folderName}</span>}
        </div>
      )}
      {kind !== "none" && (
        <div className="field">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void syncNow()}
          >
            今すぐ同期
          </button>
        </div>
      )}
      {status && <p className="sync-status">{status}</p>}

      <h2>AI (BYOK)</h2>
      <p className="hint">
        自分の Anthropic API キーでトリアージ提案を受けられます。キー未設定でも
        手動トリアージで全機能が使えます
        (劣化運転)。送信されるのは対象アイテムの
        題名・本文のみで、「AIに送らない」フラグ付きのアイテムは送信されません。
      </p>
      <p className="hint">{KEY_CONSENT_TEXT}</p>
      <div className="field field-inline">
        <input
          type="password"
          placeholder="sk-ant-…"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          autoComplete="off"
        />
        <button type="button" className="btn" onClick={saveKey}>
          保存
        </button>
      </div>
      {keyStatus && <p className="sync-status">{keyStatus}</p>}

      <h2>Microsoft 連携 (Spike)</h2>
      <p className="hint">
        OAuth (PKCE) で個人 Microsoft アカウントにサインインし、Outlook
        カレンダーへテストイベントを1件書き込みます (Issue #15)。
        サインイン状態は再起動後も維持されます。
      </p>
      {msUser ? (
        <>
          <p className="hint">サインイン中: {msUser}</p>
          <label className="field field-inline">
            <input
              type="checkbox"
              checked={pimAuto}
              onChange={(e) => {
                setAutoPimEnabled(e.target.checked);
                setPimAuto(e.target.checked);
              }}
            />
            <span>📆 アプリを開いた時に Outlook へ自動書き込み</span>
          </label>
          <div className="field field-inline">
            <button
              type="button"
              className="btn btn-primary"
              disabled={msBusy}
              onClick={() => void msTestWrite()}
            >
              テストイベントを書き込む
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void msSignOut()}
            >
              サインアウト
            </button>
          </div>
        </>
      ) : (
        <div className="field">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void msSignIn()}
          >
            Microsoft にサインイン
          </button>
        </div>
      )}
      {msStatus && <p className="sync-status">{msStatus}</p>}
    </section>
  );
}
