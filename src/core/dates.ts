import type { LocalDate, LocalDateTime } from "./types";

// タイムゾーンに依存しない日付演算。Date は UTC 固定で計算にのみ使い、
// 入出力は常にローカル表記文字列 (決定論・テスト容易性)。

export function toDate(d: LocalDate | LocalDateTime): Date {
  const [datePart = "", timePart] = d.split("T");
  const [y = 0, m = 1, day = 1] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0] = timePart ? timePart.split(":").map(Number) : [0, 0];
  return new Date(Date.UTC(y, m - 1, day, hh, mm));
}

export function toLocalDate(d: Date): LocalDate {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toLocalDateTime(d: Date): LocalDateTime {
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${toLocalDate(d)}T${hh}:${mm}`;
}

/** 実行環境の壁時計から「今」のローカル表記を得る (アプリ境界でのみ使う) */
export function wallClockNow(d: Date = new Date()): LocalDateTime {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const date = toDate(d);
  date.setUTCDate(date.getUTCDate() + days);
  return toLocalDate(date);
}

export function dateOf(dt: LocalDateTime | LocalDate): LocalDate {
  return dt.slice(0, 10);
}

export function atHour(d: LocalDate, hour: number): LocalDateTime {
  return `${d}T${hour.toString().padStart(2, "0")}:00`;
}

/** a - b の日数差 (a, b は日付) */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);
}

/** 残り時間の短縮表記: +2D / +5H / -1D (負 = 超過)。等幅前提の固定桁 */
export function remainingLabel(now: LocalDateTime, at: LocalDateTime): string {
  const mins = Math.round(
    (toDate(at).getTime() - toDate(now).getTime()) / 60000,
  );
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  if (abs >= 1440) return `${sign}${Math.floor(abs / 1440)}D`;
  return `${sign}${Math.floor(abs / 60)}H`;
}
