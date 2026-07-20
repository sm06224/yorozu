import {
  addDays,
  computeOccurrences,
  DEFAULT_REMIND_HOUR,
  dateOf,
  diffDays,
  type Item,
  type LocalDateTime,
  type SurfaceRule,
} from "../core";

// 週次レビューの内容組み立て (設計書 §10-10、#18)。純粋関数のみ。
// xlsx への変換 (write-excel-file) は xlsx.ts が担う。

export interface ReviewSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

const STATUS_JA: Record<Item["status"], string> = {
  inbox: "受信",
  active: "進行",
  waiting: "待ち",
  someday: "いつか",
  done: "完了",
  archived: "保管",
};

const KIND_JA: Record<string, string> = {
  deadline: "締切",
  reask: "再確認",
  window: "期間",
  brief: "ブリーフ",
};

/** 直近7日の完了 / 7日以上動きのない滞留 / 直近7日の発火実績 */
export function buildWeeklyReview(
  items: readonly Item[],
  rules: readonly SurfaceRule[],
  now: LocalDateTime,
): ReviewSheet[] {
  const today = dateOf(now);
  const weekAgo = `${addDays(today, -7)}T00:00`;

  const done = items
    .filter((i) => i.done_at && i.done_at >= weekAgo)
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));

  const stale = items
    .filter(
      (i) =>
        (i.status === "inbox" ||
          i.status === "active" ||
          i.status === "waiting") &&
        i.updated_at < weekAgo,
    )
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  const fired = computeOccurrences(items, rules, {
    from: addDays(today, -7),
    days: 7,
    hour: DEFAULT_REMIND_HOUR,
  });

  return [
    {
      name: "完了 (7日)",
      header: ["題名", "完了日時", "見積(分)"],
      rows: done.map((i) => [
        i.title,
        i.done_at ?? "",
        i.estimate_minutes ?? null,
      ]),
    },
    {
      name: "滞留 (7日以上)",
      header: ["状態", "題名", "最終更新", "経過日数"],
      rows: stale.map((i) => [
        STATUS_JA[i.status],
        i.title,
        i.updated_at,
        diffDays(today, dateOf(i.updated_at)),
      ]),
    },
    {
      name: "発火実績 (7日)",
      header: ["日時", "種別", "内容"],
      rows: fired.map((o) => [o.at, KIND_JA[o.kind] ?? o.kind, o.label]),
    },
  ];
}
