import { useLiveQuery } from "dexie-react-hooks";
import {
  computeOccurrences,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_REMIND_HOUR,
  dateOf,
  type Occurrence,
  wallClockNow,
} from "../core";
import { db } from "../db/db";
import { occurrencesToIcs } from "../export/ics";

// 朝ブリーフ (設計書 §2, §10-9 の表示側):
// 先読み N=7 日分の発火予定を決定論で実体化して見せる。
// 将来 PimProvider がこの同じ Occurrence 列を Outlook/To Do へ冪等 upsert する。

const KIND_LABELS: Record<Occurrence["kind"], string> = {
  deadline: "締切",
  reask: "再確認",
  window: "期間",
  brief: "ピン",
};

export function BriefView() {
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

  function downloadIcs() {
    const ics = occurrencesToIcs(occurrences, now);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yorozu-${horizon.from}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="brief">
      <div className="brief-header">
        <p className="hint">今日から {horizon.days} 日分の発火予定</p>
        <button
          type="button"
          className="btn"
          disabled={occurrences.length === 0}
          onClick={downloadIcs}
        >
          ICS書き出し
        </button>
      </div>
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
                <span className={`status-chip kind-${o.kind}`}>
                  {KIND_LABELS[o.kind]}
                </span>
                <span className="item-title">{o.label}</span>
                <span className="brief-time">{o.at.slice(11)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
