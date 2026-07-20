import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ITEM_STATUSES, type ItemStatus, wallClockNow } from "../core";
import { db } from "../db/db";
import { ItemRow, statusLabel } from "./ItemRow";

export function ListView() {
  const [filter, setFilter] = useState<ItemStatus | "all">("all");
  const [exportStatus, setExportStatus] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  async function exportReview() {
    setExportBusy(true);
    setExportStatus("週次レビューを作成中…");
    try {
      const now = wallClockNow();
      const [items, rules] = await Promise.all([
        db.items.toArray(),
        db.rules.toArray(),
      ]);
      const [{ buildWeeklyReview }, { sheetsToXlsxBlob }, save] =
        await Promise.all([
          import("../export/review"),
          import("../export/xlsx"),
          import("../export/save"),
        ]);
      const blob = await sheetsToXlsxBlob(buildWeeklyReview(items, rules, now));
      const name = `yorozu-review-${now.slice(0, 10)}.xlsx`;
      save.downloadBlob(name, blob);
      const copied = await save.saveCopyToRemote(name, blob).catch(() => false);
      setExportStatus(
        copied ? "✅ 書き出し完了 (同期先にも控えを保存)" : "✅ 書き出し完了",
      );
    } catch (e) {
      setExportStatus(`❌ 失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportBusy(false);
    }
  }
  const items = useLiveQuery(async () => {
    const coll =
      filter === "all"
        ? db.items.toCollection()
        : db.items.where("status").equals(filter);
    const list = await coll.toArray();
    return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [filter]);

  return (
    <section>
      <div className="chip-row">
        <button
          type="button"
          className={`chip ${filter === "all" ? "chip-on" : ""}`}
          onClick={() => setFilter("all")}
        >
          すべて
        </button>
        {ITEM_STATUSES.map((s) => (
          <button
            type="button"
            key={s}
            className={`chip ${filter === s ? "chip-on" : ""}`}
            onClick={() => setFilter(s)}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>
      <ul className="item-list">
        {items?.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      {items?.length === 0 && <p className="empty">アイテムがありません</p>}
      <div className="brief-actions">
        <span className="brief-actions-label">レビュー:</span>
        <button
          type="button"
          className="btn"
          disabled={exportBusy}
          onClick={() => void exportReview()}
        >
          📊 週次レビュー (xlsx)
        </button>
      </div>
      {exportStatus && <p className="sync-status">{exportStatus}</p>}
    </section>
  );
}
