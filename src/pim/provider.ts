import type { Occurrence } from "../core";

// PimProvider IF (設計書 §2, §10-8): 「通知を作らず、書き込む」の本丸。
// 決定論で計算した発火予定 (Occurrence) を PIM へ冪等 upsert する。
// 突合キーは occurrence.key (item:rule:at) を本文/メモ欄に埋め込む。
// Graph/Google 呼び出しは必ずこの IF の背後に置く (§12.3)。

export interface UpsertResult {
  created: number;
  skipped: number;
  /** 過去に書いたが PIM 側で消されていた件数 (再作成しない = PIM が勝つ) */
  respected: number;
}

// 意思決定 (planUpsert) はアダプタの外 (pim/plan.ts + pim/sync.ts)。
// アダプタは「期間内の既存キー列挙」と「作成」だけを担う。
export interface PimProvider {
  readonly kind: string;
  /** 期間内にある yorozu 生成エントリの突合キー集合 */
  listExistingKeys(
    from: Occurrence["at"],
    to: Occurrence["at"],
  ): Promise<Set<string>>;
  /** エントリを作成する (呼び出し側が新規と判断したものだけ渡す) */
  createEntries(occurrences: readonly Occurrence[]): Promise<void>;
}

/** 突合キーを本文に埋める/取り出すための目印 */
export const KEY_MARKER = "yorozu-key:";

export function bodyWithKey(key: string): string {
  return `YOROZU が自動生成した予定です。\n${KEY_MARKER}${key}`;
}

export function extractKey(text: string): string | null {
  const i = text.indexOf(KEY_MARKER);
  if (i === -1) return null;
  const rest = text.slice(i + KEY_MARKER.length);
  return rest.split(/[\s<"]/)[0] || null;
}
