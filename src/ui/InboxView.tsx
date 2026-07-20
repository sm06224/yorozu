import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { CaptureBox } from "./CaptureBox";
import { ItemRow } from "./ItemRow";

export function InboxView() {
  const items = useLiveQuery(
    () => db.items.where("status").equals("inbox").sortBy("created_at"),
    [],
  );

  return (
    <section>
      <CaptureBox />
      <ul className="item-list">
        {items?.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      {items?.length === 0 && <p className="empty">受信箱は空です 🎉</p>}
    </section>
  );
}
