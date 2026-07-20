import { useState } from "react";
import { captureItem } from "../db/repo";

export function CaptureBox() {
  const [text, setText] = useState("");

  async function submit() {
    const t = text.trim();
    if (!t) return;
    await captureItem(t);
    setText("");
  }

  return (
    <form
      className="capture"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        className="capture-input"
        type="text"
        value={text}
        placeholder="頭の中のものを放り込む…"
        onChange={(e) => setText(e.target.value)}
        // biome-ignore lint/a11y/noAutofocus: キャプチャ最優先のUX
        autoFocus
      />
      <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
        追加
      </button>
    </form>
  );
}
