import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../db/db";
import { msLikelySignedIn } from "../pim/msal";
import { getConfiguredProvider } from "../sync/config";
import { syncOnce } from "../sync/engine";
import { BriefView } from "./BriefView";
import { InboxView } from "./InboxView";
import { ListView } from "./ListView";
import { SettingsView } from "./SettingsView";
import { TriageView } from "./TriageView";

const TABS = [
  { key: "brief", label: "予定" },
  { key: "inbox", label: "受信箱" },
  { key: "triage", label: "トリアージ" },
  { key: "list", label: "一覧" },
  { key: "settings", label: "設定" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function App() {
  const [tab, setTab] = useState<TabKey>("inbox");

  // 開時同期 (設計書 §2): アプリを開いた時に静かに追いつく。失敗は無視。
  useEffect(() => {
    void (async () => {
      const provider = await getConfiguredProvider(db, false);
      if (provider) await syncOnce(db, provider).catch(() => undefined);
    })();
  }, []);

  // OAuth リダイレクトからの戻り (URL に code がある時) と既存サインインの復元
  useEffect(() => {
    if (window.location.hash.includes("code=") || msLikelySignedIn()) {
      void import("../pim/msal").then((m) =>
        m.ensureMsal().catch(() => undefined),
      );
    }
  }, []);

  const inboxCount = useLiveQuery(
    () => db.items.where("status").equals("inbox").count(),
    [],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>YOROZU</h1>
        <p className="tagline">通知を作らず、書き込む</p>
      </header>
      <nav className="tab-nav">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            className={`tab ${tab === t.key ? "tab-on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "triage" && (inboxCount ?? 0) > 0 && (
              <span className="badge">{inboxCount}</span>
            )}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {tab === "brief" && <BriefView />}
        {tab === "inbox" && <InboxView />}
        {tab === "triage" && <TriageView />}
        {tab === "list" && <ListView />}
        {tab === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
