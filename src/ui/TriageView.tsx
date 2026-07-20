import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { getApiKey } from "../ai/key";
import { suggestTriage, type TriageSuggestion } from "../ai/triage";
import { type LocalDate, wallClockNow } from "../core";
import { db } from "../db/db";
import { applyTriage, type TriageDecision } from "../db/repo";
import { statusLabel } from "./ItemRow";

function statusJa(s: TriageSuggestion["status"]): string {
  return statusLabel(s);
}

// 一問一答トリアージ (設計書 §10-3): 受信箱の先頭から1件ずつ、
// 「どうする?」だけに答えて次へ進む。AI 未設定でも全機能が回る劣化運転の土台。

const REASK_CHOICES = [
  { days: 0, label: "再確認なし" },
  { days: 7, label: "1週間後に再確認" },
  { days: 30, label: "1ヶ月後に再確認" },
  { days: 90, label: "3ヶ月後に再確認" },
] as const;

export function TriageView() {
  const inbox = useLiveQuery(
    () => db.items.where("status").equals("inbox").sortBy("created_at"),
    [],
  );
  const [due, setDue] = useState<LocalDate | "">("");
  const [reask, setReask] = useState(0);
  const [aiAllowed, setAiAllowed] = useState(true);
  const [suggestion, setSuggestion] = useState<TriageSuggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const current = inbox?.[0];
  if (!inbox) return null;
  if (!current) {
    return <p className="empty">トリアージ完了。受信箱は空です 🎉</p>;
  }

  const apiKey = getApiKey();

  async function askAi() {
    if (!current || !apiKey) return;
    setAiBusy(true);
    setAiError("");
    try {
      const s = await suggestTriage(
        apiKey,
        current,
        wallClockNow().slice(0, 10),
      );
      setSuggestion(s);
      if (s.due) setDue(s.due);
      if (s.reask_days > 0) setReask(s.reask_days);
    } catch (e) {
      setAiError(`AI提案に失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function decide(status: TriageDecision["status"]) {
    if (!current) return;
    const d: TriageDecision = { status, ai_allowed: aiAllowed };
    if (due) d.due = { date: due };
    if (reask > 0) d.reask_days = reask;
    await applyTriage(current.id, d);
    setDue("");
    setReask(0);
    setAiAllowed(true);
    setSuggestion(null);
    setAiError("");
  }

  return (
    <section className="triage">
      <p className="triage-progress">残り {inbox.length} 件</p>
      <div className="triage-card">
        <h2 className="triage-title">{current.title}</h2>

        {apiKey && aiAllowed && (
          <div className="ai-suggest">
            <button
              type="button"
              className="btn"
              disabled={aiBusy}
              onClick={() => void askAi()}
            >
              {aiBusy ? "AIが考え中…" : "🤖 AIに提案してもらう"}
            </button>
            {suggestion && (
              <p className="ai-reason">
                提案: <strong>{statusJa(suggestion.status)}</strong> —{" "}
                {suggestion.reason}
              </p>
            )}
            {aiError && <p className="ai-error">{aiError}</p>}
          </div>
        )}

        <label className="field">
          <span>期日 (任意)</span>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value as LocalDate)}
          />
        </label>

        <label className="field">
          <span>再確認</span>
          <select
            value={reask}
            onChange={(e) => setReask(Number(e.target.value))}
          >
            {REASK_CHOICES.map((c) => (
              <option key={c.days} value={c.days}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-inline">
          <input
            type="checkbox"
            checked={!aiAllowed}
            onChange={(e) => setAiAllowed(!e.target.checked)}
          />
          <span>AIに送らない</span>
        </label>

        <div className="triage-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void decide("active")}
            data-suggested={suggestion?.status === "active" || undefined}
          >
            今やる
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void decide("waiting")}
            data-suggested={suggestion?.status === "waiting" || undefined}
          >
            待ち
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void decide("someday")}
            data-suggested={suggestion?.status === "someday" || undefined}
          >
            いつか
          </button>
          <button
            type="button"
            className="btn btn-ok"
            onClick={() => void decide("done")}
            data-suggested={suggestion?.status === "done" || undefined}
          >
            もう済んだ
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void decide("archived")}
            data-suggested={suggestion?.status === "archived" || undefined}
          >
            破棄
          </button>
        </div>
      </div>
    </section>
  );
}
