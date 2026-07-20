import { db } from "../db/db";
import { getConfiguredProvider } from "../sync/config";

// 書き出しファイルの共通処理: 端末へダウンロード + 同期先にも控えを置く (§3)

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 同期先が putFile 対応なら控えを保存する。保存したら true */
export async function saveCopyToRemote(
  name: string,
  blob: Blob,
): Promise<boolean> {
  const provider = await getConfiguredProvider(db, false);
  if (!provider?.putFile) return false;
  await provider.putFile(name, blob);
  return true;
}
