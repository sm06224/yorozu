import { Component, type ReactNode } from "react";
import { dlog } from "../debug/log";

// 白画面防止 (#25 の教訓): 描画中の例外はここで止めて、
// エラー内容と再読込の導線を必ず見せる。データは Dexie にあるので消えない。

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    dlog("crash", error.message, error.stack?.slice(0, 400));
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <h2>⚠ 画面の描画に失敗しました</h2>
        <p className="ai-error">
          {this.state.error.message || String(this.state.error)}
        </p>
        <p className="hint">
          データは端末内 (IndexedDB) に保存されており消えていません。
          再読込で直らない場合は、この画面のスクショを Issue に貼ってください。
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          再読み込み
        </button>
      </div>
    );
  }
}
