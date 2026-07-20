import { addDays, atHour, dateOf, diffDays } from "./dates";
import type {
  BriefRule,
  DeadlineRule,
  Item,
  LocalDate,
  Occurrence,
  ReaskRule,
  SurfaceRule,
  WindowRule,
} from "./types";

// 再浮上エンジン (設計書 §2): 大半が決定論 = 事前計算可能。
// from から horizon_days 日分の発火予定を純関数で計算する。
// 同じ入力からは常に同じ Occurrence 列 (key 含む) が得られ、
// key を突合キーとした PIM への冪等 upsert が成立する。

export interface Horizon {
  /** この日を含めて先読みを開始する日 */
  from: LocalDate;
  /** 先読み日数 (既定 N=7) */
  days: number;
  /** リマインドを実体化する時刻 (時) */
  hour: number;
}

export const DEFAULT_HORIZON_DAYS = 7;
export const DEFAULT_REMIND_HOUR = 9;

export function occurrenceKey(
  itemId: string,
  ruleId: string,
  at: string,
): string {
  return `${itemId}:${ruleId}:${at}`;
}

function inHorizon(date: LocalDate, h: Horizon): boolean {
  const d = diffDays(date, h.from);
  return d >= 0 && d < h.days;
}

function deadlineOccurrences(
  rule: DeadlineRule,
  item: Item,
  h: Horizon,
): Occurrence[] {
  const dueDate = dateOf(rule.due);
  const out: Occurrence[] = [];
  // lead_days 重複は同一発火に潰す (Set)
  for (const lead of [...new Set(rule.lead_days)].sort((a, b) => b - a)) {
    const date = addDays(dueDate, -lead);
    if (!inHorizon(date, h)) continue;
    const at = lead === 0 ? rule.due : atHour(date, h.hour);
    out.push({
      key: occurrenceKey(item.id, rule.id, at),
      item_id: item.id,
      rule_id: rule.id,
      kind: "deadline",
      at,
      label:
        lead === 0 ? `締切: ${item.title}` : `締切まで${lead}日: ${item.title}`,
    });
  }
  return out;
}

function reaskOccurrences(
  rule: ReaskRule,
  item: Item,
  h: Horizon,
): Occurrence[] {
  const out: Occurrence[] = [];
  // anchor から interval_days ごと。horizon 内の発火だけを列挙する。
  const sinceAnchor = diffDays(h.from, rule.anchor);
  // horizon 開始以降で最初の発火回 (anchor 当日は発火しない = n>=1)
  let n = Math.max(1, Math.ceil(sinceAnchor / rule.interval_days));
  for (; ; n += 1) {
    const date = addDays(rule.anchor, n * rule.interval_days);
    if (diffDays(date, h.from) >= h.days) break;
    if (!inHorizon(date, h)) continue;
    const at = atHour(date, h.hour);
    out.push({
      key: occurrenceKey(item.id, rule.id, at),
      item_id: item.id,
      rule_id: rule.id,
      kind: "reask",
      at,
      label: `まだ要る?: ${item.title}`,
    });
  }
  return out;
}

function windowOccurrences(
  rule: WindowRule,
  item: Item,
  h: Horizon,
): Occurrence[] {
  const out: Occurrence[] = [];
  const candidates: Array<{ date: LocalDate; label: string }> = [
    { date: rule.start, label: `開始: ${item.title}` },
  ];
  const closing = addDays(rule.end, -1);
  if (closing !== rule.start) {
    candidates.push({ date: closing, label: `明日終了: ${item.title}` });
  }
  for (const c of candidates) {
    if (!inHorizon(c.date, h)) continue;
    const at = atHour(c.date, h.hour);
    out.push({
      key: occurrenceKey(item.id, rule.id, at),
      item_id: item.id,
      rule_id: rule.id,
      kind: "window",
      at,
      label: c.label,
    });
  }
  return out;
}

function briefOccurrences(
  rule: BriefRule,
  item: Item,
  h: Horizon,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (let i = 0; i < h.days; i += 1) {
    const at = atHour(addDays(h.from, i), h.hour);
    out.push({
      key: occurrenceKey(item.id, rule.id, at),
      item_id: item.id,
      rule_id: rule.id,
      kind: "brief",
      at,
      label: `ブリーフ: ${item.title}`,
    });
  }
  return out;
}

const INACTIVE_STATUSES = new Set(["done", "archived"]);

/**
 * 先読み horizon 内の全発火予定を計算する (決定論)。
 * - done/archived のアイテム・無効ルール・対応アイテムのないルールは発火しない
 * - 出力は at → key の辞書順で安定ソート
 */
export function computeOccurrences(
  items: readonly Item[],
  rules: readonly SurfaceRule[],
  horizon: Horizon,
): Occurrence[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: Occurrence[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const item = byId.get(rule.item_id);
    if (!item || INACTIVE_STATUSES.has(item.status)) continue;
    switch (rule.kind) {
      case "deadline":
        out.push(...deadlineOccurrences(rule, item, horizon));
        break;
      case "reask":
        out.push(...reaskOccurrences(rule, item, horizon));
        break;
      case "window":
        out.push(...windowOccurrences(rule, item, horizon));
        break;
      case "brief":
        out.push(...briefOccurrences(rule, item, horizon));
        break;
    }
  }
  return out.sort((a, b) =>
    a.at === b.at ? a.key.localeCompare(b.key) : a.at.localeCompare(b.at),
  );
}
