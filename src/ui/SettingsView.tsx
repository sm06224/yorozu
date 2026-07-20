import { useEffect, useState } from "react";
import { getApiKey, KEY_CONSENT_TEXT, setApiKey } from "../ai/key";
import { db } from "../db/db";
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

  useEffect(() => {
    void getSyncKind(db).then(setKind);
  }, []);

  async function changeKind(next: SyncKind) {
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
      setStatus(`同期エラー: ${e instanceof Error ? e.message : String(e)}`);
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
    </section>
  );
}
