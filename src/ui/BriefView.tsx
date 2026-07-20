import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import {
  computeOccurrences,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_REMIND_HOUR,
  dateOf,
  type Occurrence,
  remainingLabel,
  wallClockNow,
} from "../core";
import { db } from "../db/db";
import { occurrencesToIcs } from "../export/ics";
import { msLikelySignedIn } from "../pim/msal";

// 朝ブリーフ (設計書 §2, §10-9 の表示側):
// 先読み N=7 日分の発火予定を決定論で実体化して見せる。
// 将来 PimProvider がこの同じ Occurrence 列を Outlook/To Do へ冪等 upsert する。

const KIND_LABELS: Record<Occurrence["kind"], string> = {
  deadline: "⏰",
  reask: "🔁",
  window: "📅",
  brief: "📌",
};

function deltaClass(now: string, at: string): string {
  if (at < now) return "kind-deadline";
  return remainingLabel(now, at).endsWith("D") ? "delta-d" : "delta-h";
}

function stripPrefix(label: string): string {
  return label.replace(
    /^(締切まで\d+日|締切|まだ要る\?|開始|明日終了|ブリーフ): /,
    "",
  );
}

export function BriefView() {
  const [pimStatus, setPimStatus] = useState("");
  const [pimBusy, setPimBusy] = useState(false);
  const data = useLiveQuery(async () => {
    const [items, rules] = await Promise.all([
      db.items.toArray(),
      db.rules.toArray(),
    ]);
    return { items, rules };
  }, []);

  if (!data) return null;

  const now = wallClockNow();
  const horizon = {
    from: dateOf(now),
    days: DEFAULT_HORIZON_DAYS,
    hour: DEFAULT_REMIND_HOUR,
  };
  const occurrences = computeOccurrences(data.items, data.rules, horizon);

  const byDate = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const d = dateOf(o.at);
    const list = byDate.get(d) ?? [];
    list.push(o);
    byDate.set(d, list);
  }

  async function writeToOutlook() {
    setPimBusy(true);
    setPimStatus("Outlook へ書き込み中…");
    try {
      const [{ OutlookPimProvider }, { pimUpsert }] = await Promise.all([
        import("../pim/outlook"),
        import("../pim/sync"),
      ]);
      const r = await pimUpsert(new OutlookPimProvider(), occurrences, now);
      const respected =
        r.respected > 0
          ? ` / PIM側で削除済み ${r.respected} 件は再作成せず`
          : "";
      setPimStatus(
        `✅ Outlook: 新規 ${r.created} 件 / 既存 ${r.skipped} 件${respected}`,
      );
    } catch (e) {
      setPimStatus(`❌ 失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPimBusy(false);
    }
  }

  async function downloadIcs() {
    const ics = occurrencesToIcs(occurrences, now);
    const blob = new Blob([ics], { type: "text/calendar" });
    const name = `yorozu-${horizon.from}.ics`;
    const save = await import("../export/save");
    save.downloadBlob(name, blob);
    if (await save.saveCopyToRemote(name, blob).catch(() => false)) {
      setPimStatus("✅ ICS を書き出し (同期先にも控えを保存)");
    }
  }

  return (
    <section className="brief">
      <p className="hint">今日から {horizon.days} 日分の発火予定</p>
      <div className="brief-actions">
        <span className="brief-actions-label">予定表へ:</span>
        {msLikelySignedIn() && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={occurrences.length === 0 || pimBusy}
            onClick={() => void writeToOutlook()}
          >
            📆 Outlookへ書き込む
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={occurrences.length === 0}
          onClick={() => void downloadIcs()}
        >
          📤 予定表に送る (ICS)
        </button>
      </div>
      {pimStatus && <p className="sync-status">{pimStatus}</p>}
      {occurrences.length === 0 && (
        <p className="empty">
          予定はありません。トリアージで期日や再確認を設定すると、ここに現れます。
        </p>
      )}
      {[...byDate.entries()].map(([date, list]) => (
        <div key={date} className="brief-day">
          <h2 className="brief-date">{date}</h2>
          <ul className="item-list">
            {list.map((o) => (
              <li key={o.key} className="item-row">
                <span className={`kind-mark kind-${o.kind}`}>
                  {KIND_LABELS[o.kind]}
                </span>
                <span className={`brief-delta ${deltaClass(now, o.at)}`}>
                  {remainingLabel(now, o.at)}
                </span>
                <span className="item-title">{stripPrefix(o.label)}</span>
                <span className="brief-time">{o.at.slice(11)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
