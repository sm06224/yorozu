# YOROZU 開発ガイド

単人・ゼロランニングコストの PIM PWA。設計の一次情報は `docs/design/` (最新差分が優先)。

## コマンド

- `pnpm dev` — 開発サーバ
- `pnpm check` — typecheck + lint + test (コミット前に必ず通す)
- `pnpm lint:fix` — Biome 自動整形
- `pnpm build` — 本番ビルド (CSP メタ注入込み)
- `pnpm e2e` — Playwright スモークテスト (要: 事前 `pnpm build`。
  Claude Code リモート環境では `CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`)

## アーキテクチャ原則 (設計書 v0.3 より)

- **サーバは存在しない**。恒常費 $0。ローカル正は Dexie(IndexedDB)
- **通知を作らず、書き込む**: 再浮上エンジンは決定論で先読み計算し、PIM (Outlook/To Do) へ冪等 upsert。通知はネイティブアプリに委譲
- **外部スクリプト読み込み禁止・厳格 CSP** (CI で強制)。XSS 面を潰すことが BYOK キー保護の本丸
- Graph/Google 呼び出しは **Provider IF の背後のみ** (`StorageProvider` / `PimProvider`)
- AI は BYOK 直叩き (`anthropic-dangerous-direct-browser-access`)。キー未設定でも手動で全機能が回る (劣化運転)
- PIM 側の手動編集は「PIM が勝つ」。item_id 突合の冪等 upsert
- 同期は `journal.jsonl` (追記専用) + `snapshot.json` + cursor。item 粒度 LWW、本文マージはしない

## モジュール構成

```
src/
  core/     — Item/SurfaceRule 型、Zod 検証、決定論の発火計算 (純粋関数のみ、DOM 依存禁止)
  db/       — Dexie スキーマ・リポジトリ
  sync/     — StorageProvider IF + アダプタ (fsa/idb/onedrive)
  ai/       — BYOK Claude クライアント
  pim/      — PimProvider IF + アダプタ
  export/   — ICS/xlsx 書き出し
  ui/       — React コンポーネント
```

## 規約

- コミット前に `pnpm check` を通す。CI は gitleaks も必須
- 秘密情報 (API キー・トークン) をコードやテストフィクスチャに書かない
- `space_id` 等 v0.2 の列はスキーマに残す (棚上げであり削除ではない)
- 時刻を扱う純粋関数は `now` を引数で受け取る (決定論・テスト容易性)

## ユーザーの視覚特性 (UI変更時は必ず /visual-check を通す)

- **低コントラストを識別できない** → 文字は WCAG AA (4.5:1) 以上。`src/a11y/contrast.test.ts` が強制。基準を下げる変更は禁止
- **乱視** — ダークモード単独は目が痛い → ライト/ダーク両対応 (`prefers-color-scheme`)。ライト背景は純白を避ける
- **斜視 (左右視差で行の段ずれ)** → 行に明確な境界線+縞 (zebra)、揃え位置を統一、浮遊する小さな文字を作らない
- **デザイン規範 (確定)**: 等幅フォント / 高密度・隙間なし (zebra+極薄罫線) / カード・ピル・下線リンク風は禁止 / ボタンと入力欄は同じ「明確な箱」(raised背景+全周ボーダー+角丸6px、ピル不可)、主要操作は塗り (accent-strong)。ブラケット表記だけのテキスト風ボタンは不可 / ラベルは入力の左 (同一行) / 色数最小 (accent+dangerのみ)、区別は絵文字で / 面の分離 (bg と raised) を明確に。行内の小操作 (✓↩) のみ箱なし可

## 運用教訓

> このファイルは肥大化させない: 各セクション10行以内。追記ではなく統合・置換で更新する。

- アプリ内で完結する検証は自分で行う (e2e + `scripts/shots.mjs` のスクショを自分の目で見る)。ユーザーに頼むのは実アカウント連携の確認のみ
- UI 変更はライト/ダーク両方のスクショを見てから出す
- 人間の操作が必要な手順は Issue/PR コメントに書き、URL を渡す
