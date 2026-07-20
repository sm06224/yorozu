import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../db/db";
import { InboxView } from "./InboxView";
import { ListView } from "./ListView";
import { TriageView } from "./TriageView";

const TABS = [
  { key: "inbox", label: "受信箱" },
  { key: "triage", label: "トリアージ" },
  { key: "list", label: "一覧" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function App() {
  const [tab, setTab] = useState<TabKey>("inbox");
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
        {tab === "inbox" && <InboxView />}
        {tab === "triage" && <TriageView />}
        {tab === "list" && <ListView />}
      </main>
    </div>
  );
}
