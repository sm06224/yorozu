import {
  computeOccurrences,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_REMIND_HOUR,
  dateOf,
  type LocalDateTime,
  type Occurrence,
  toDate,
  toLocalDateTime,
  wallClockNow,
} from "../core";
import { db, getMeta, setMeta } from "../db/db";
import { dlog } from "../debug/log";
import { msLikelySignedIn } from "./msal";
import { planUpsert, pruneWrittenKeys } from "./plan";
import type { PimProvider, UpsertResult } from "./provider";

// PIM 書き込みのオーケストレーション (#17 reconcile):
// 「書いた記録」を meta に持ち、PIM 側で消されたエントリは再作成しない (PIM が勝つ)。

const LAST_RUN_META = "pim.lastrun.outlook";
const AUTO_LS_KEY = "yorozu_pim_auto";
const TODO_LS_KEY = "yorozu_pim_todo";

function writtenMeta(provider: PimProvider): string {
  // 旧キー互換: outlook は従来の pim.written.outlook をそのまま使う
  return `pim.written.${provider.kind}`;
}

export function isAutoPimEnabled(): boolean {
  return localStorage.getItem(AUTO_LS_KEY) !== "0";
}

export function setAutoPimEnabled(on: boolean): void {
  localStorage.setItem(AUTO_LS_KEY, on ? "1" : "0");
}

/** 再確認/期間を To Do のタスクとして書くか (既定 OFF = 全部カレンダー) */
export function isTodoSplitEnabled(): boolean {
  return localStorage.getItem(TODO_LS_KEY) === "1";
}

export function setTodoSplitEnabled(on: boolean): void {
  localStorage.setItem(TODO_LS_KEY, on ? "1" : "0");
}

function windowEnd(last: Occurrence): LocalDateTime {
  const d = toDate(last.at);
  d.setUTCMinutes(d.getUTCMinutes() + 15);
  return toLocalDateTime(d);
}

export async function pimUpsert(
  provider: PimProvider,
  occurrences: readonly Occurrence[],
  now: LocalDateTime,
): Promise<UpsertResult> {
  if (occurrences.length === 0) return { created: 0, skipped: 0, respected: 0 };
  const sorted = [...occurrences].sort((a, b) => a.at.localeCompare(b.at));
  const first = sorted[0] as Occurrence;
  const last = sorted[sorted.length - 1] as Occurrence;

  const existing = await provider.listExistingKeys(first.at, windowEnd(last));
  const written = new Set(
    (await getMeta<string[]>(db, writtenMeta(provider))) ?? [],
  );

  const plan = planUpsert(sorted, existing, written);
  dlog(
    "pim",
    `plan[${provider.kind}]: create=${plan.toCreate.length} skip=${plan.skippedExisting} respect=${plan.respectedDeleted} (existing=${existing.size} written=${written.size})`,
  );
  await provider.createEntries(plan.toCreate);

  for (const o of plan.toCreate) written.add(o.key);
  for (const k of existing) written.add(k);
  await setMeta(db, writtenMeta(provider), pruneWrittenKeys(written, now));

  return {
    created: plan.toCreate.length,
    skipped: plan.skippedExisting,
    respected: plan.respectedDeleted,
  };
}

/** kind による振り分け (設計書 §2): 締切/ブリーフ→カレンダー、再確認/期間→To Do */
export function splitForTodo(occurrences: readonly Occurrence[]): {
  calendar: Occurrence[];
  todo: Occurrence[];
} {
  const calendar: Occurrence[] = [];
  const todo: Occurrence[] = [];
  for (const o of occurrences) {
    (o.kind === "reask" || o.kind === "window" ? todo : calendar).push(o);
  }
  return { calendar, todo };
}

/**
 * 発火予定を PIM へ書く。To Do 分割が有効なら reask/window はタスクに、
 * それ以外はカレンダーに (無効なら全部カレンダー)。
 */
export async function pimWriteAll(
  occurrences: readonly Occurrence[],
  now: LocalDateTime,
  providers?: { calendar: PimProvider; todo: PimProvider | null },
): Promise<UpsertResult> {
  const calendar =
    providers?.calendar ?? new (await import("./outlook")).OutlookPimProvider();
  const todoProvider = providers
    ? providers.todo
    : isTodoSplitEnabled()
      ? new (await import("./todo")).TodoPimProvider()
      : null;

  if (!todoProvider) return pimUpsert(calendar, occurrences, now);

  const split = splitForTodo(occurrences);
  const [rc, rt] = [
    await pimUpsert(calendar, split.calendar, now),
    await pimUpsert(todoProvider, split.todo, now),
  ];
  return {
    created: rc.created + rt.created,
    skipped: rc.skipped + rt.skipped,
    respected: rc.respected + rt.respected,
  };
}

/** 現在の DB 全体から horizon 分の発火予定を計算して書く */
export async function pimUpsertAll(
  now: LocalDateTime = wallClockNow(),
): Promise<UpsertResult> {
  const [items, rules] = await Promise.all([
    db.items.toArray(),
    db.rules.toArray(),
  ]);
  const occurrences = computeOccurrences(items, rules, {
    from: dateOf(now),
    days: DEFAULT_HORIZON_DAYS,
    hour: DEFAULT_REMIND_HOUR,
  });
  return pimWriteAll(occurrences, now);
}

/**
 * 起動時の自動書き込み (設計書 §2「開時同期」の PIM 側)。
 * サイレントトークンが取れる場合のみ・1時間に1回まで。失敗は静かに諦める
 * (次回起動 or 手動ボタンで追いつく)。
 */
export async function autoPimUpsert(): Promise<UpsertResult | null> {
  if (!isAutoPimEnabled() || !msLikelySignedIn()) {
    dlog("pim", "auto: skip (無効 or 未サインイン)");
    return null;
  }
  const now = wallClockNow();
  const lastRun = (await getMeta<string>(db, LAST_RUN_META)) ?? "";
  if (lastRun && minutesBetween(lastRun, now) < 60) {
    dlog("pim", `auto: skip (前回 ${lastRun} から1時間未満)`);
    return null;
  }
  try {
    const r = await pimUpsertAll(now);
    await setMeta(db, LAST_RUN_META, now);
    dlog("pim", `auto: ok created=${r.created} skipped=${r.skipped}`);
    return r;
  } catch (e) {
    dlog("pim", "auto: 失敗 (次回に持ち越し)", e);
    return null;
  }
}

function minutesBetween(a: LocalDateTime, b: LocalDateTime): number {
  return Math.abs(toDate(b).getTime() - toDate(a).getTime()) / 60000;
}
