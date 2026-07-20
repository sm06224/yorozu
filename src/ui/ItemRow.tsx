import type { Item, ItemStatus } from "../core";
import { setStatus } from "../db/repo";

const STATUS_LABELS: Record<ItemStatus, string> = {
  inbox: "受信箱",
  active: "進行中",
  waiting: "待ち",
  someday: "いつか",
  done: "完了",
  archived: "保管",
};

export function statusLabel(s: ItemStatus): string {
  return STATUS_LABELS[s];
}

export function ItemRow({ item }: { item: Item }) {
  const closed = item.status === "done" || item.status === "archived";
  return (
    <li className={`item-row ${closed ? "item-closed" : ""}`}>
      <span className={`status-chip status-${item.status}`}>
        {STATUS_LABELS[item.status]}
      </span>
      <span className="item-title">{item.title}</span>
      <span className="item-actions">
        {!closed && (
          <button
            type="button"
            className="btn btn-ghost"
            title="完了にする"
            onClick={() => void setStatus(item.id, "done")}
          >
            ✓
          </button>
        )}
        {closed && (
          <button
            type="button"
            className="btn btn-ghost"
            title="受信箱に戻す"
            onClick={() => void setStatus(item.id, "inbox")}
          >
            ↩
          </button>
        )}
      </span>
    </li>
  );
}
