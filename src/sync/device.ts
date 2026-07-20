const KEY = "yorozu.device";

/** 端末識別子 (journal エントリの来歴表示用) */
export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID().slice(0, 8);
    localStorage.setItem(KEY, id);
  }
  return id;
}
