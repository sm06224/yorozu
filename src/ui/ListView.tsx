import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ITEM_STATUSES, type ItemStatus } from "../core";
import { db } from "../db/db";
import { ItemRow, statusLabel } from "./ItemRow";

export function ListView() {
  const [filter, setFilter] = useState<ItemStatus | "all">("all");
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
    </section>
  );
}
