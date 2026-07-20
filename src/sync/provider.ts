// StorageProvider IF (設計書 §1, §10-7)
// OneDrive/Google Drive/ローカル (FSA)/ブラウザ内 (IDB, dev用) を同じ形で扱う。
// クラウド API の呼び出しは必ずこの IF の背後に置く (§12.3 横断規約)。
//
// リモートは app 専用フォルダに2ファイルだけ持つ:
//   journal.jsonl — 追記専用の変更ログ。行番号 (0起点) がそのまま位置
//   snapshot.json — 定期スナップショット (ブートストラップ高速化 + バックアップ)

export interface StorageProvider {
  readonly kind: string;
  readonly label: string;
  /** journal の末尾に行を追記し、追記後の総行数を返す */
  appendJournal(lines: string[]): Promise<number>;
  /** fromLine (0起点) 以降の journal 行を返す */
  readJournal(fromLine: number): Promise<string[]>;
  /** journal の総行数 */
  journalLength(): Promise<number>;
  writeSnapshot(json: string): Promise<void>;
  readSnapshot(): Promise<string | null>;
  /** 書き出しファイル (ICS/xlsx 等) の控えを同じ場所に置く (§3、任意実装) */
  putFile?(name: string, data: Blob): Promise<void>;
}
