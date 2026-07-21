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

const WRITTEN_META = "pim.written.outlook";
const LAST_RUN_META = "pim.lastrun.outlook";
const AUTO_LS_KEY = "yorozu_pim_auto";

export function isAutoPimEnabled(): boolean {
  return localStorage.getItem(AUTO_LS_KEY) !== "0";
}

export function setAutoPimEnabled(on: boolean): void {
  localStorage.setItem(AUTO_LS_KEY, on ? "1" : "0");
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
  const written = new Set((await getMeta<string[]>(db, WRITTEN_META)) ?? []);

  const plan = planUpsert(sorted, existing, written);
  dlog(
    "pim",
    `plan: create=${plan.toCreate.length} skip=${plan.skippedExisting} respect=${plan.respectedDeleted} (existing=${existing.size} written=${written.size})`,
  );
  await provider.createEntries(plan.toCreate);

  for (const o of plan.toCreate) written.add(o.key);
  for (const k of existing) written.add(k);
  await setMeta(db, WRITTEN_META, pruneWrittenKeys(written, now));

  return {
    created: plan.toCreate.length,
    skipped: plan.skippedExisting,
    respected: plan.respectedDeleted,
  };
}

/** 現在の DB 全体から horizon 分の発火予定を計算して upsert する */
export async function pimUpsertAll(
  provider: PimProvider,
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
  return pimUpsert(provider, occurrences, now);
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
    const { OutlookPimProvider } = await import("./outlook");
    const r = await pimUpsertAll(new OutlookPimProvider(), now);
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
