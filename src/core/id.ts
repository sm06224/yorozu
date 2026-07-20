// 時刻順ソート可能な短い ID。先頭が時刻 (36進) なので journal 上でも追いやすい。
export function newId(now: Date = new Date()): string {
  const t = now.getTime().toString(36);
  const r = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return `${t}-${r}`;
}
