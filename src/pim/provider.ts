import type { Occurrence } from "../core";

// PimProvider IF (設計書 §2, §10-8): 「通知を作らず、書き込む」の本丸。
// 決定論で計算した発火予定 (Occurrence) を PIM へ冪等 upsert する。
// 突合キーは occurrence.key (item:rule:at) を本文/メモ欄に埋め込む。
// Graph/Google 呼び出しは必ずこの IF の背後に置く (§12.3)。

export interface UpsertResult {
  created: number;
  skipped: number;
  /** horizon 内なのに PIM 側から消えていた等の差分 (delta 表示用) */
  notes: string[];
}

export interface PimProvider {
  readonly kind: string;
  /**
   * 発火予定を冪等 upsert する。既に同じキーのエントリがあれば作らない。
   * PIM 側の手動編集 (移動・削除・完了) はそのまま尊重する = 「PIM が勝つ」(§9)。
   */
  upsertOccurrences(occurrences: readonly Occurrence[]): Promise<UpsertResult>;
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
