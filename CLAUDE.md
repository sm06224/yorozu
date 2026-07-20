# YOROZU 開発ガイド

単人・ゼロランニングコストの PIM PWA。設計の一次情報は `docs/design/` (最新差分が優先)。

## コマンド

- `pnpm dev` — 開発サーバ
- `pnpm check` — typecheck + lint + test (コミット前に必ず通す)
- `pnpm lint:fix` — Biome 自動整形
- `pnpm build` — 本番ビルド (CSP メタ注入込み)

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
