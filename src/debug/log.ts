// 診断ログ (実機デバッグ用)。iPhone では console が見えないため、
// アプリ内リングバッファ + localStorage 永続 (クラッシュ後も残る) にし、
// 設定画面から閲覧・コピーできるようにする。秘密情報 (トークン/キー) は絶対に記録しない。

const LS_KEY = "yorozu_debug_log";
const MAX_ENTRIES = 500;
const MAX_DATA_LEN = 500;

export interface LogEntry {
  /** ISO 時刻 (壁時計)。境界ログなので決定論は不要 */
  t: string;
  scope: string;
  msg: string;
  data?: string;
}

let buf: LogEntry[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): LogEntry[] {
  if (buf) return buf;
  try {
    buf = JSON.parse(storage()?.getItem(LS_KEY) ?? "[]") as LogEntry[];
  } catch {
    buf = [];
  }
  return buf;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      storage()?.setItem(LS_KEY, JSON.stringify(load()));
    } catch {
      // 容量超過等は諦める (ログのために本体を壊さない)
    }
  }, 300);
}

function serialize(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  try {
    const s =
      data instanceof Error
        ? `${data.name}: ${data.message}`
        : JSON.stringify(data);
    return s && s.length > MAX_DATA_LEN ? `${s.slice(0, MAX_DATA_LEN)}…` : s;
  } catch {
    return String(data);
  }
}

/** 診断ログに1行書く。console にも流す */
export function dlog(scope: string, msg: string, data?: unknown): void {
  const d = serialize(data);
  const entry: LogEntry = {
    t: new Date().toISOString(),
    scope,
    msg,
    ...(d === undefined ? {} : { data: d }),
  };
  const b = load();
  b.push(entry);
  if (b.length > MAX_ENTRIES) b.splice(0, b.length - MAX_ENTRIES);
  scheduleFlush();
  // eslint 対象外: 診断用の意図的な console 出力
  console.debug(`[${scope}] ${msg}`, data ?? "");
}

export function readLog(): LogEntry[] {
  return [...load()];
}

export function clearLog(): void {
  buf = [];
  try {
    storage()?.removeItem(LS_KEY);
  } catch {
    // noop
  }
}

/** コピー/Issue 貼り付け用のテキスト形式 */
export function logText(): string {
  return load()
    .map((e) => `${e.t} [${e.scope}] ${e.msg}${e.data ? ` ${e.data}` : ""}`)
    .join("\n");
}

/** 未捕捉エラーも診断ログへ (main.tsx から一度だけ呼ぶ) */
export function installGlobalErrorLog(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (ev) => {
    dlog("uncaught", ev.message, `${ev.filename}:${ev.lineno}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    dlog("unhandled", "promise rejection", ev.reason);
  });
}
