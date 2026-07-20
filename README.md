# YOROZU

単人・ゼロランニングコストの PIM (Personal Information Management) PWA。

「通知を作らず、書き込む」— 再浮上エンジンが計算した発火予定を Outlook カレンダー / Microsoft To Do へ冪等 upsert し、通知はネイティブアプリに委譲する。サーバは存在しない。

## アーキテクチャ

```
静的PWA (GitHub Pages / Cloudflare Pages, $0)
 ├─ ローカル正: Dexie(IndexedDB) / 将来OPFS
 ├─ StorageProvider ─ OneDrive approot │ Google Drive appDataFolder │ FSA/IDB(dev)
 ├─ PimProvider ──── Outlookカレンダー+To Do │ GCal+Tasks
 └─ AIClient ─────── Claude API 直叩き (BYOK)
```

- 恒常費 **$0** + AI 従量のみ
- 認証は OAuth (PKCE) をブラウザで完結、クライアントシークレット無し
- 厳格 CSP・サードパーティスクリプト 0 をリリース条件とする
- キー未設定でも手動トリアージで全機能が回る(劣化運転)

設計書: [docs/design/](docs/design/)

## 公開版

main へのマージで GitHub Pages に自動デプロイされます:
**https://sm06224.github.io/yorozu/**

## 開発

```sh
pnpm install
pnpm dev        # 開発サーバ
pnpm test       # Vitest
pnpm check      # typecheck + lint + test
pnpm build      # 本番ビルド (厳格CSPメタ注入込み)
pnpm e2e        # Playwright スモークテスト (要: pnpm build)
```

## License

MIT
