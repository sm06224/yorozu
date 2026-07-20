import { useState } from "react";
import type { Item, ItemStatus } from "../core";
import { setStatus } from "../db/repo";
import { AttachmentStrip } from "./AttachmentStrip";

const STATUS_LABELS: Record<ItemStatus, string> = {
  inbox: "📥受信",
  active: "🔥進行",
  waiting: "⏳待ち",
  someday: "🌙いつか",
  done: "✅完了",
  archived: "🗄保管",
};

export function statusLabel(s: ItemStatus): string {
  return STATUS_LABELS[s];
}

export function ItemRow({ item }: { item: Item }) {
  const closed = item.status === "done" || item.status === "archived";
  const [showAtt, setShowAtt] = useState(false);
  return (
    <>
      <li className={`item-row ${closed ? "item-closed" : ""}`}>
        <span className={`status-chip status-${item.status}`}>
          {STATUS_LABELS[item.status]}
        </span>
        <span className="item-title">{item.title}</span>
        <span className="item-actions">
          <button
            type="button"
            className="btn btn-ghost"
            title="添付ファイル"
            onClick={() => setShowAtt((v) => !v)}
          >
            📎{item.attachments.length > 0 ? item.attachments.length : ""}
          </button>
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
          {item.status !== "inbox" && (
            <button
              type="button"
              className="btn btn-ghost"
              title="受信箱に戻して再トリアージ (期日/再確認を設定)"
              onClick={() => void setStatus(item.id, "inbox")}
            >
              ↩
            </button>
          )}
        </span>
      </li>
      {showAtt && <AttachmentStrip item={item} />}
    </>
  );
}
