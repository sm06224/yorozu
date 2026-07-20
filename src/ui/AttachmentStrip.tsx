import { useRef, useState } from "react";
import type { AttachmentRef, Item } from "../core";
import {
  addAttachment,
  getAttachmentBlob,
  removeAttachment,
} from "../db/attachments";

// 添付ストリップ (#25): 行の下に1行だけ出る。追加/開く/外す。
// blob はローカル優先、無ければ同期先から遅延ダウンロード。

function kb(size: number): string {
  return size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`;
}

export function AttachmentStrip({ item }: { item: Item }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setStatus("");
    for (const f of files) {
      await addAttachment(item.id, f).catch((e) =>
        setStatus(`❌ ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  async function open(ref: AttachmentRef) {
    setStatus("");
    const blob = await getAttachmentBlob(ref.file_id);
    if (!blob) {
      setStatus("❌ 本体が見つかりません (同期先が未設定か、未アップロード)");
      return;
    }
    const url = URL.createObjectURL(
      ref.mime ? new Blob([blob], { type: ref.mime }) : blob,
    );
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <li className="attachment-strip">
      {(item.attachments ?? []).map((a) => (
        <span key={a.file_id} className="attachment-entry">
          <button
            type="button"
            className="btn btn-ghost attachment-open"
            title={`開く (${a.mime || "不明"})`}
            onClick={() => void open(a)}
          >
            📎{a.name} ({kb(a.size)})
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            title="この添付を外す (同期先の本体は残る)"
            onClick={() => void removeAttachment(item.id, a.file_id)}
          >
            ✕
          </button>
        </span>
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        title="ファイルを添付"
        onClick={() => fileInput.current?.click()}
      >
        ＋添付
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void pick(e.target.files);
          e.target.value = "";
        }}
      />
      {status && <span className="ai-error">{status}</span>}
    </li>
  );
}
