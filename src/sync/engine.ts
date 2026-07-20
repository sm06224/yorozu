import { addDays, dateOf, type LocalDateTime, wallClockNow } from "../core";
import { getMeta, setMeta, type YorozuDB } from "../db/db";
import { getDeviceId } from "./device";
import {
  type JournalEntry,
  mergeTombstones,
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
/** compaction 後も journal 末尾にこれだけ残す (追従中の端末が再ブートストラップせずに済むように) */
const COMPACT_KEEP_TAIL = 200;
/** これ以上切り詰められる時だけ compaction を実行する (毎回の書き直しを避ける) */
const COMPACT_MIN_GAIN = 200;
/** snapshot に持ち回るトンボストーンの保持日数 */
const TOMBSTONE_KEEP_DAYS = 90;

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

/** snapshot を適用して新カーソル (journal_len) を返す。読めなければ null */
async function bootstrapFromSnapshot(
  db: YorozuDB,
  provider: StorageProvider,
): Promise<{ cursor: number; applied: number } | null> {
  // 壊れた snapshot は無視して journal 全再生にフォールバック
  const snap = await readSnapshotSafe(provider);
  if (!snap) return null;
  const entries: JournalEntry[] = [
    ...snap.items.map(
      (payload) =>
        ({ op: "upsert_item", device: "snapshot", payload }) as const,
    ),
    ...snap.rules.map(
      (payload) =>
        ({ op: "upsert_rule", device: "snapshot", payload }) as const,
    ),
    // compaction で journal から消えた削除もここで再現される (復活防止)
    ...snap.tombstones.map(
      (t) => ({ op: t.op, device: "snapshot", id: t.id, ts: t.ts }) as const,
    ),
  ];
  const applied = await applyEntries(db, entries);
  return { cursor: snap.journal_len, applied };
}

/** 読めなければ null (snapshot なし・壊れている・旧形式でない不正) */
async function readSnapshotSafe(
  provider: StorageProvider,
): Promise<Snapshot | null> {
  const raw = await provider.readSnapshot();
  if (!raw) return null;
  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function syncOnce(
  db: YorozuDB,
  provider: StorageProvider,
  now: LocalDateTime = wallClockNow(),
): Promise<SyncResult> {
  let cursor = (await getMeta<number>(db, cursorKey(provider))) ?? 0;
  let applied = 0;
  let pulled = 0;

  // 新規端末: snapshot からブートストラップ (journal 全再生の短絡)
  if (cursor === 0) {
    const boot = await bootstrapFromSnapshot(db, provider);
    if (boot) {
      applied += boot.applied;
      cursor = boot.cursor;
    }
  } else if (provider.journalBase) {
    // 取り残し端末: カーソルより先まで journal が切り詰められていたら
    // snapshot (切り詰め範囲を必ず含む) で追いつく (#25)
    const base = await provider.journalBase();
    if (cursor < base) {
      const boot = await bootstrapFromSnapshot(db, provider);
      if (!boot) {
        throw new Error(
          "journal が切り詰め済みで snapshot も読めません。リモートの snapshot.json を確認してください",
        );
      }
      applied += boot.applied;
      cursor = Math.max(cursor, boot.cursor);
    }
  }

  const bootstrapped = cursor > 0;

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

  // 空のリモートへの初回同期で outbox も空なら (他プロバイダで消費済み)、
  // ローカル全量を種まきする (別リモートへの乗り換え・バックアップ先追加を成立させる)
  if (
    !bootstrapped &&
    cursor === 0 &&
    lines.length === 0 &&
    outbox.length === 0
  ) {
    const device = getDeviceId();
    const seed: JournalEntry[] = [
      ...(await db.items.toArray()).map(
        (payload) => ({ op: "upsert_item", device, payload }) as const,
      ),
      ...(await db.rules.toArray()).map(
        (payload) => ({ op: "upsert_rule", device, payload }) as const,
      ),
    ];
    if (seed.length > 0) {
      const newLen = await provider.appendJournal(seed.map(serializeEntry));
      pushed += seed.length;
      if (newLen === seed.length) cursor = newLen;
    }
  }

  if (outbox.length > 0) {
    const newLen = await provider.appendJournal(
      outbox.map((o) => serializeEntry(o.entry)),
    );
    const maxSeq = outbox[outbox.length - 1]?.seq;
    if (maxSeq !== undefined) {
      await db.outbox.where("seq").belowOrEqual(maxSeq).delete();
    }
    pushed += outbox.length;
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
    // トンボストーンは前回 snapshot から引き継ぎ、journal に残る削除と統合する
    // (compaction で journal から消えても削除が復活しないように)
    const prevSnap = await readSnapshotSafe(provider);
    const base = provider.journalBase ? await provider.journalBase() : 0;
    const allEntries = (await provider.readJournal(base))
      .map(parseEntry)
      .filter((e): e is JournalEntry => e !== null);
    const cutoff: LocalDateTime = `${addDays(dateOf(now), -TOMBSTONE_KEEP_DAYS)}T00:00`;
    const snap: Snapshot = {
      version: 1,
      journal_len: cursor,
      items: await db.items.toArray(),
      rules: await db.rules.toArray(),
      tombstones: mergeTombstones(
        prevSnap?.tombstones ?? [],
        allEntries,
        cutoff,
      ),
    };
    await provider.writeSnapshot(JSON.stringify(snap));
    await setMeta(db, `sync.snaplen.${provider.kind}`, cursor);

    // compaction (#25): snapshot 済み範囲の journal を切り詰めて
    // read-modify-write 追記のコストを抑える。末尾は残して
    // 追従中の他端末が再ブートストラップせずに済むようにする
    if (provider.compactJournal && provider.journalBase) {
      const upTo = cursor - COMPACT_KEEP_TAIL;
      if (upTo - base >= COMPACT_MIN_GAIN) {
        await provider.compactJournal(upTo);
      }
    }
  }

  return { pulled, applied, pushed };
}
