# YOROZU v0.3 差分 — 単人・ゼロランニングコスト・PIM連携アーキテクチャ

位置づけ: v0.1/v0.2への差分。矛盾時は本書が優先。v0.2（共有スペース）は**棚上げ**（削除ではない。多人数はサーバ再導入とセットで将来判断。space_id等の列はローカルスキーマに残して害なし）。

---

## 0. 判定（結論先出し）

| 論点 | 判定 |
|---|---|
| 利用者 | 当人＋AIのみ。認証サーバ・共有機構は撤去 |
| ランニングコスト | **恒常費$0**＋AI従量のみ。VPS/PocketBase/Web Push基盤を全廃 |
| 同期バックボーン | **OneDrive(Graph API)を先行採用**、Googleは第二アダプタ。**iCloudは非採用**（理由§4） |
| 通知 | **自前で作らない。書き込む**（§2）。これによりv0.1 §9のiOS Push制約・ホーム画面追加必須が丸ごと消滅 |
| オフィススイート連携 | Graph経由: Outlookカレンダー/To Do（通知の本丸）＋Excel書き出し（週次レビュー） |

---

## 1. 新アーキテクチャ

```
静的PWA (Cloudflare Pages / GitHub Pages, $0)
 ├─ ローカル正: Dexie(IndexedDB) / 将来OPFS
 ├─ StorageProvider ─ OneDrive approot │ Google Drive appDataFolder   ← 同期・バックアップ
 ├─ PimProvider ──── Outlookカレンダー+To Do │ GCal+Tasks              ← 再浮上の実体化
 └─ AIClient ─────── Claude API 直叩き(BYOK)                           ← §5
```

- サーバは存在しない。認証はOAuth(PKCE, クライアントシークレット無し)をブラウザで完結。
- アプリ登録: Entra ID(無料) / Google Cloudプロジェクト(無料)。スコープは最小（例: Files.ReadWrite.AppFolder, Calendars.ReadWrite, Tasks.ReadWrite / drive.appdata 等。**正式名称は実装時に公式で確認**）。

## 2. 核となる転換: 「通知を作らず、書き込む」

再浮上エンジン（v0.1 §5のルール群）は**大半が決定論**＝事前計算可能。よって:

1. アプリを開いた時（＋任意で夜間cron）、**先読みN=7日分**の発火予定を計算
2. Outlookカレンダー（brief・deadline系）と Microsoft To Do（reask・window系）へ **冪等upsert**（イベント/タスク本文にitem_idを埋め、突合キーにする）
3. 通知はMicrosoft/Googleの**ネイティブアプリが配達**（iOSで一級市民。到達率・省電力・Watch表示すべて自前Web Pushより上位互換）
4. アプリ再開時にreconcile: 完了・移動・削除を双方向に突き合わせ、差分はdelta表示へ

**帰結**: ホーム画面追加もWeb Pushも不要になり、Safariタブ運用ですら成立する。v0.1最大のプラットフォームリスクが構造的に消える。
**限界（明記）**: ブリーフの内容は「最後に開いた時 or 最後のcron時点」の鮮度。既定は開時実体化のみ。鮮度が欲しければGitHub Actionsの夜間cron（無料枠内・リフレッシュトークンをSecrets保管）を任意で足す——ただしトークンをGitHubに置くトレードオフを設定画面で明示。

## 3. 同期方式（単人前提の簡素化）

- app専用フォルダに `journal.jsonl`（追記専用の変更ログ）＋ 定期 `snapshot.json`（圧縮）。各端末はカーソル以降のjournalを取り込む。
- 書き手は実質1人＝競合は稀。item粒度LWWで許容、本文の同時編集マージはやらない（v0.1の決定を維持）。
- これがそのままバックアップになる（ユーザーの既存ストレージ容量を使うため追加費$0）。ICS/xlsx書き出しも同フォルダへ。

## 4. iCloudの正直な評価（非採用の理由）

- iCloudにはサードパーティWebアプリ向けの汎用ストレージAPIが無い。CloudKit(JS)は存在するが**Apple Developer Program（年99ドル）加入がコンテナ作成の前提**＝「ほぼ無料」に反する。
- Mac側で `~/Library/Mobile Documents/…` に書けばiCloud同期はされるが、**iPhone側のPWAからの書き込み経路が無い**ため同期バックボーンとして片肺。
- 結論: 同期はOneDrive/Google。iCloudへは「Filesアプリ経由の手動書き出し」導線のみ用意。将来ネイティブ殻（Tauri/Capacitor）を被せる時に再検討。

## 5. AI層（BYOK直叩き・検証済み）

- Anthropic APIはリクエストヘッダ `anthropic-dangerous-direct-browser-access: true` を付けることでブラウザからのCORS呼び出しを公式に許可しており、TypeScript SDKにも `dangerouslyAllowBrowser: true` がある。想定用途としてBYOK（利用者が自分のキーを入れる）パターンが明示されている——本件はまさにこれ。
- キーは設定画面で入力→localStorage保存（同意文言つき）。**厳格CSP・サードパーティスクリプト0**をリリース条件にしてXSS面を潰す（キー窃取の主経路対策）。
- 送信は該当アイテム本文のみ／item単位の「AIに送らない」フラグ維持（v0.1 §7踏襲）。モデルは逐次トリアージ=最安級、週次まとめ=中位。**モデル名・料金は実装時に公式参照**: https://docs.claude.com/en/api/overview
- 劣化運転維持: キー未設定でも手動トリアージで全機能が回る。

## 6. コスト表（恒常費）

| 項目 | 費用 |
|---|---|
| ホスティング(静的) | $0 |
| 同期/バックアップ | $0（既存アカウント容量） |
| 通知 | $0（ネイティブアプリに委譲） |
| 認証・アプリ登録 | $0 |
| AI | 従量のみ（軽量モデル・夜間バッチ方針で最小化） |
| 撤去したもの | VPS・PocketBase・Web Push基盤・独自ドメイン(任意) |

## 7. アカウント衛生（重要な運用規約）

- **職場のM365 E5テナントに私物データを置かない**。理由: テナント管理者からの可視性、アプリ登録ポリシーの制約、離職時の消失。**個人Microsoftアカウント**（無料OneDrive枠）を使う。設定画面でサインイン先のテナント種別を検出し、組織アカウントなら警告を出す実装にする。

## 8. リリース梯子 改訂

| 週 | 出すもの | DoD |
|---|---|---|
| W0(2日) | **Spike**: iOSホーム画面PWA/SafariタブでのOAuth(PKCE)往復＋Graphへイベント1件書き込み | 認証→書き込み→再起動後もトークン維持、を実機確認 |
| W1 | ローカル単独版（v0.1 W1）＋**BYOK AIトリアージ前倒し**（サーバ不要化の配当） | AI提案→批准ループがローカルで成立 |
| W2 | StorageProvider＋OneDrive approot同期（journal/snapshot/cursor） | Mac⇄iPhoneで同一データ・オフライン編集後の追いつき |
| W3 | PimProvider＋実体化エンジン（先読み・冪等upsert・reconcile）＋朝ブリーフ | 通知がOutlook/To Doから届き、全件来歴つき |
| W4 | ICS/xlsx書き出し・delta/reask仕上げ → **β** | 実データ1週間破綻なし |

ハードカット規約（v0.1 §10）は据え置き。

## 9. リスク改訂

| リスク | 対策 |
|---|---|
| iOSインストール型PWAでのOAuthリダイレクト不安定 | W0 Spikeで最初に潰す。**不成立でもSafariタブ運用が完全成立**（Push非依存化の配当）なので致命傷にならない |
| ブラウザ内トークン/キーのXSS窃取 | 厳格CSP・外部スクリプト0・依存最小をCIで強制。スコープ最小化 |
| 職場テナント混用 | §7の検出＋警告 |
| 実体化の鮮度切れ | N日先読み＋開時reconcile。任意cronは明示的オプトイン |
| PIM側での手動編集との衝突 | item_id突合の冪等upsert＋「PIM側の変更が勝つ」規則を固定（ユーザーがネイティブアプリで動かした事実を尊重） |

## 10. Claude Code Issue差し替え（v0.1 §12.2 / v0.2 §8 を置換）

0. **Spike**: PKCE認証(MSAL相当)＋Graphイベント書き込み1本、iOS実機（最優先・他に先行）
1. core: item/surface_rule型＋検証（v0.1どおり）
2. web: キャプチャ＋Dexie＋一覧
3. web: 一問一答トリアージUI（手動）
4. core: 決定論パッカー（プロパティテスト）
5. ics: RRULE展開＋スナップショットテスト（役割はバックアップ/相互運用）
6. ai: BYOKブラウザ直クライアント（ヘッダ実装・設定画面・手動フォールバック）
7. storage: Provider IF＋OneDrive approotアダプタ（journal/snapshot/cursor）
8. pim: Provider IF＋Graphカレンダー/To Doアダプタ（冪等upsert・item_id埋込）
9. materializer: 先読みN日＋reconcile（＋任意Actions cronテンプレ、既定OFF）
10. export: xlsx週次＋ICS＋approotへの保存

横断規約（v0.1 §12.3）に追加: 「外部スクリプト読み込み禁止」「CSPをテストで固定」「Graph/Google呼び出しはProvider IFの背後のみ」。

## 11. 参照（本差分の裏づけ）
- Anthropic CORSヘッダとBYOK用途: https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/
- SDKのブラウザ許可フラグ: https://github.com/vercel/ai/issues/3041 （dangerouslyAllowBrowser言及）
- Claude API公式（モデル・料金・仕様の一次情報）: https://docs.claude.com/en/api/overview
- ほかはv0.1付録B・v0.2 §9を継承。

---
v0.3 おわり。次の変更は v0.4 差分として作成。
