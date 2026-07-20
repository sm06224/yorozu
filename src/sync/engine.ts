import { getMeta, setMeta, type YorozuDB } from "../db/db";
import {
  type JournalEntry,
  parseEntry,
  type Snapshot,
  SnapshotSchema,
  serializeEntry,
} from "./journal";
import type { StorageProvider } from "./provider";

// 同期エンジン (設計書 §3): pull → LWW適用 → push → snapshot 保守。
// 書き手は実質1人なので競合は稀。item 粒度 LWW (updated_at 比較)、
// 本文の同時編集マージはしない。

export interface SyncResult {
  pulled: number;
  applied: number;
  pushed: number;
}

/** snapshot をこの行数ごとに書き直す */
const SNAPSHOT_EVERY = 200;

async function applyEntries(
  db: YorozuDB,
  entries: JournalEntry[],
): Promise<number> {
  let applied = 0;
  // リモート適用は repo を通らない = outbox に echo しない
  await db.transaction("rw", db.items, db.rules, async () => {
    for (const e of entries) {
      switch (e.op) {
        case "upsert_item": {
          const cur = await db.items.get(e.payload.id);
          if (!cur || e.payload.updated_at > cur.updated_at) {
            await db.items.put(e.payload);
            applied += 1;
          }
          break;
        }
        case "upsert_rule": {
          const cur = await db.rules.get(e.payload.id);
          if (!cur || e.payload.updated_at > cur.updated_at) {
            await db.rules.put(e.payload);
            applied += 1;
          }
          break;
        }
        case "delete_item": {
          const cur = await db.items.get(e.id);
          if (cur && e.ts >= cur.updated_at) {
            await db.items.delete(e.id);
            applied += 1;
          }
          break;
        }
        case "delete_rule": {
          const cur = await db.rules.get(e.id);
          if (cur && e.ts >= cur.updated_at) {
            await db.rules.delete(e.id);
            applied += 1;
          }
          break;
        }
      }
    }
  });
  return applied;
}

function cursorKey(provider: StorageProvider): string {
  return `sync.cursor.${provider.kind}`;
}

export async function syncOnce(
  db: YorozuDB,
  provider: StorageProvider,
): Promise<SyncResult> {
  let cursor = (await getMeta<number>(db, cursorKey(provider))) ?? 0;
  let applied = 0;
  let pulled = 0;

  // 新規端末: snapshot からブートストラップ (journal 全再生の短絡)
  if (cursor === 0) {
    const raw = await provider.readSnapshot();
    if (raw) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null; // 壊れた snapshot は無視して journal 全再生にフォールバック
      }
      const parsed = SnapshotSchema.safeParse(json);
      if (parsed.success) {
        const snap = parsed.data;
        const entries: JournalEntry[] = [
          ...snap.items.map(
            (payload) =>
              ({ op: "upsert_item", device: "snapshot", payload }) as const,
          ),
          ...snap.rules.map(
            (payload) =>
              ({ op: "upsert_rule", device: "snapshot", payload }) as const,
          ),
        ];
        applied += await applyEntries(db, entries);
        cursor = snap.journal_len;
      }
    }
  }

  // pull: カーソル以降の journal を取り込む
  const lines = await provider.readJournal(cursor);
  pulled = lines.length;
  const entries = lines
    .map(parseEntry)
    .filter((e): e is JournalEntry => e !== null);
  applied += await applyEntries(db, entries);
  cursor += lines.length;

  // push: outbox を追記
  const outbox = await db.outbox.orderBy("seq").toArray();
  let pushed = 0;
  if (outbox.length > 0) {
    const newLen = await provider.appendJournal(
      outbox.map((o) => serializeEntry(o.entry)),
    );
    const maxSeq = outbox[outbox.length - 1]?.seq;
    if (maxSeq !== undefined) {
      await db.outbox.where("seq").belowOrEqual(maxSeq).delete();
    }
    pushed = outbox.length;
    // 追記中に他端末の書き込みが挟まらなければ自分の行は読み戻さなくてよい。
    // 挟まった場合はカーソルを進めず、次回 pull で LWW が no-op として吸収する。
    if (newLen === cursor + outbox.length) cursor = newLen;
  }

  await setMeta(db, cursorKey(provider), cursor);

  // snapshot 保守: 一定行数ごとに全量を書き直す (バックアップ兼ブートストラップ短絡)
  const lastSnapLen =
    (await getMeta<number>(db, `sync.snaplen.${provider.kind}`)) ?? 0;
  if (
    cursor - lastSnapLen >= SNAPSHOT_EVERY ||
    (lastSnapLen === 0 && cursor > 0)
  ) {
    const snap: Snapshot = {
      version: 1,
      journal_len: cursor,
      items: await db.items.toArray(),
      rules: await db.rules.toArray(),
    };
    await provider.writeSnapshot(JSON.stringify(snap));
    await setMeta(db, `sync.snaplen.${provider.kind}`, cursor);
  }

  return { pulled, applied, pushed };
}
