import type { LocalDateTime, Occurrence } from "../core";

// reconcile の純粋な意思決定 (設計書 §9「PIM が勝つ」):
// - PIM に既にある → 何もしない (skipped)
// - PIM に無いが、過去に自分が書いた → ユーザーが PIM 側で消した。再作成しない (respected)
// - PIM に無く、書いた記録も無い → 新規作成 (toCreate)

export interface UpsertPlan {
  toCreate: Occurrence[];
  skippedExisting: number;
  respectedDeleted: number;
}

export function planUpsert(
  occurrences: readonly Occurrence[],
  existingKeys: ReadonlySet<string>,
  writtenKeys: ReadonlySet<string>,
): UpsertPlan {
  const plan: UpsertPlan = {
    toCreate: [],
    skippedExisting: 0,
    respectedDeleted: 0,
  };
  for (const o of occurrences) {
    if (existingKeys.has(o.key)) plan.skippedExisting += 1;
    else if (writtenKeys.has(o.key)) plan.respectedDeleted += 1;
    else plan.toCreate.push(o);
  }
  return plan;
}

/** key は `${item_id}:${rule_id}:${at}` (at = YYYY-MM-DDTHH:mm 固定16桁) */
export function keyAt(key: string): LocalDateTime {
  return key.slice(-16);
}

/** 書き込み記録から過去分を落とす (今日以降だけ残す)。記録の無限成長を防ぐ */
export function pruneWrittenKeys(
  keys: Iterable<string>,
  now: LocalDateTime,
): string[] {
  const today = `${now.slice(0, 10)}T00:00`;
  return [...keys].filter((k) => keyAt(k) >= today).sort();
}
