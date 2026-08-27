# UI 画面仕様（画面一覧・状態・遷移・エラー）

| 項目 | 内容 |
|---|---|
| 版 | v0.9（2026-08-27） |
| 対応要件 | `docs/requirements.md` v0.1.11 §4 FR-01〜19、§9.2、§10.3、§11.3 / 11.4、§15 |
| Figma | `UI Design (Team B)` — ページ **Prototype / Screens**（全画面・全状態、Standard、Present で遷移可）/ **Prototype / Screens (極ドパ)** / **Prototype / Flow**（遷移図）。コンポーネントは同ファイルのデザインシステム（Getting Started 参照） |
| アセット | `docs/ui-design/*.png`（抜粋スクリーンショット） |
| 目的 | 実装者が「どのルートで・どの状態のとき・何を出すか」を迷わないための SSOT。API 契約は requirements §10、エラー形式は §10.3 |

## 0. 読み方

- 画面 ID `S-xx`、ダイアログ `D-xx`、パネル `P-xx`。Figma のフレーム名と一致する（例 `S-13 Dashboard / 同期エラー`）。
- 状態は **通常 / 空 / 読み込み / エラー** の 4 種を基本とし、画面固有の状態を追加している。
- 「使用コンポーネント」は Figma のコンポーネント名。実装は同名の React コンポーネント（`apps/web/components/ui/*`）を想定。
- テーマは `Standard` / `極ドパ` の 2 モード。全画面が Color コレクションのモードだけで切り替わる（コンポーネント差し替えなし）。
- 本書で要件側の決定が必要な事項は §7 に集約している（`docs/requirements.md` は本書では変更しない）。

## 1. 共通レイアウト・共通ルール

| 領域 | 仕様 |
|---|---|
| 幅 | デスクトップ最大 1280px（`size/page` = `--size-page` = 80rem）。`max-w-page` + `w-full` の可変幅で中央寄せ、外側は `bg/default`。`html` の font-size を ≥1536px で 106.25%、≥1920px で 112.5% に上げるため、大画面では rem 基準の幅・余白・文字が一緒に拡大する。数値の正は `docs/specs/web-ui.md` §3.2。モバイルは §7-6 参照 |
| サイドバー | 224px（`size/sidebar` = `--size-sidebar` = 14rem）。Logo → 主要 CTA「+ ドメインを取得」→ ナビ（ダッシュボード / 移管 / 設定）→ 下部にテーマトグル（Segmented Small）+ ユーザー名 + ログアウト。「ドメイン取得」は CTA と同じ `/domains/new` を指すため、ナビ項目には出さず CTA 1 本にする（CTA は現在地のとき Active 表示）。「ログ」は開発者向けなのでナビに出さず `/settings` の「開発者向け」から入る。Active は `Sidebar` の `Active` バリアント。`md` 未満ではサイドバーの代わりに `MobileNav`（横ナビ）を上部に出す |
| メイン | padding 20/24、gap 12–16。先頭に `Page Header`（Title / Meta / Action）または見出し行 |
| バナー | 画面内の結果・警告は `Banner`（Ok / Warn / Info）をメイン先頭に 1 つだけ置く。トーストは使わない |
| 認証 | `/`・`/signup`・`/login` 以外の全ルートが認証必須。未認証は `/login?next=<path>`（S-02、reason なし）、API 401（セッション失効）は `/login?reason=expired&next=<path>`（S-03）。ログイン / サインアップ成功後は `next` へ戻る（AC-01-3） |
| 非対応環境 | `window.PublicKeyCredential` 不在時は S-01c / S-02c を表示。S-00 の CTA 押下時にも同判定を行う |
| 所有権なし / 未登録 | `/domains/[name]` で `FORBIDDEN` / `NOT_FOUND` → S-80（「ダッシュボードへ」） |

## 2. 画面一覧と状態

### 2.1 認証（FR-01）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-00 | `/` | ランディング | Top Bar、ヒーロー（CTA「パスキーではじめる」→ S-01、「ログイン」→ S-02）、お試しスコア（§7-1 参照：未認証 API が決まるまでは「ログイン後に利用可」の表示） | Top Bar, Button, Input, Score Gauge, Similarity Row |
| S-01 | `/signup` | 通常 | 表示名（1〜32 文字、超過はクライアント + サーバーで弾く）+「パスキーを作成する」。成功で `next` または S-11（初回はドメイン 0 件） | Logo, Input, Button, Divider |
| S-01b | `/signup` | パスキー作成失敗 | Banner Warn「パスキーを作成できませんでした」。キャンセル / タイムアウト / 非対応を同一文言で扱い、再試行可 | Banner |
| S-01c | `/signup` | 非対応環境（AC-01-5） | Empty State Warn。フォールバック認証は提供しない | Empty State |
| S-02 | `/login` | 通常 | ボタン 1 つ（テキスト入力なし・AC-01-2）。成功で `next` または S-10 | Button |
| S-02b | `/login` | 認証失敗 | Banner Warn「ログインできませんでした」。signature counter 後退（AC-01-4）も同文言 + 操作ログ記録 | Banner |
| S-02c | `/login` | 非対応環境（AC-01-5） | S-01c と同じ Empty State Warn、ボタン非表示 | Empty State |
| S-03 | `/login?reason=expired` | セッション失効 | Banner Info「セッションの有効期限が切れました」 | Banner |

### 2.2 ダッシュボード（FR-02）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-10 | `/dashboard` | 通常 | Page Header（件数・最終同期・「最新化」）+ Domain Card 2 列グリッド。カードの表示項目: ドメイン名 / 状態バッジ / 進捗（残日数）/ レジストリ名 / 有効期限 or 残日数 / 最終同期（Meta 右端、キャッシュ時は「未同期」バッジ（`Badge` tone=muted）を最終同期テキストの左に置く）/ 操作。「詳細」→ S-30、「今すぐ更新」→ D-01、「復旧する」→ D-04、「状態を確認」→ S-50、「NS を設定」→ D-02 | Page Header, Domain Card |
| S-11 | `/dashboard` | 0 件 | Empty State Neutral + CTA「ドメインを取得」→ S-20、「移管で持ち込む」→ S-50 | Empty State |
| S-12 | `/dashboard` | 読み込み | Skeleton（ヘッダー + カード 4）。DB キャッシュを先に描画し、`POST /domains/sync` はバックグラウンド | Skeleton |
| S-13 | `/dashboard` | 同期エラー（AC-18-1） | Banner Warn。`POST /domains/sync` は部分失敗でも 200 + `failures[]` を返すので、見出しと案内は `failures[].code`（+ リクエストごとの失敗なら `error.code`）で出し分ける（`REGISTRY_TIMEOUT` / `REGISTRY_UNAVAILABLE` →「〇〇が応答しません — 一覧はキャッシュを表示しています」+「参照系は自動で 2 回再試行しました」、`REGISTRY_SPEC_MISMATCH` →「〇〇の応答が想定と異なります — レジストリの仕様変更の可能性があります」+ 操作ログ導線、`REGISTRY_REJECTED` →「〇〇が最新化を拒否しました」+ 理由（API が `registry-codes.ts` の表から `message` に載せたもの。1 つに定まらなければ操作ログへ誘導）、`NOT_FOUND` →「〇〇に登録が見つかりません」（再試行の記述は出さない）、それ以外 →「一覧を最新化できませんでした」）。コードが混ざるときは最も重い区分（応答なし > 想定外の応答 > 拒否 > レジストリに未登録 > その他）の見出しを採り、本文に内訳（「応答なし 1 件・レジストリに未登録 2 件」）を添える。主語は見出しに採った区分の `failures[].registry`（TLD から特定）から生成し、リクエストごとの失敗のときは `error.registry`、どちらも無ければ stale なカードのレジストリから推定する（「Kitaqsign が…」「Kitaqnic が…」「両レジストリが…」）。部分失敗のときは「n 件が最新化できませんでした」を本文に添える。Banner に最終同期時刻は書かない。同期に失敗したカードだけ「未同期」バッジ（`Badge` tone=muted）+「最終同期 n 分前」を Meta 右端に表示し、更新系操作は Disabled（参照系の「詳細 / 状態を確認」は塞がない） | Banner |

**Domain Card の Status（§9.2 `deriveDisplayStatus` と 1:1）**

| Status | 導出元 | バッジ（Tone） | 進捗 | 主操作 |
|---|---|---|---|---|
| Active | `active` | Active（Ok） | Brand | 更新 / 詳細 |
| Expiring | `active` かつ残 30 日以内（AC-02-2） | ⚠ 残 n 日（Warn）、枠 Warn | Warn | 今すぐ更新 / 詳細 |
| Redeemable | `rgp` | 復旧猶予 残 n 日（Warn）（AC-10-1） | — | 復旧する / 詳細 |
| PendingDelete | `pending_delete` | 削除待ち（Muted Solid）、75% | — | 詳細のみ（`redemptionPeriod` を伴わない場合のみ。伴うなら Redeemable） |
| Transferring | `transfer_out_pending`（受信）/ `transfer_in_pending` は `/transfers` のみ | 移管申請中（Muted）、75% | — | 状態を確認 |
| Hold | `hold` | 停止中（Warn）、枠 Warn | — | 情報修正 / 詳細 |
| Inactive | `inactive` | NS 未設定（Neutral） | Brand | NS を設定 / 詳細 |
| Locked | `locked`（client/server *Prohibited のみ） | 移管ロック / 削除ロック / 更新ロック（Neutral、lock アイコン） | Brand | 更新 / 詳細 |

`transferred_out` は保有一覧に出さない（AC-02-4）。

### 2.3 ドメイン取得（FR-03 / 04 / 05 / 06）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-20 | `/domains/new` | 初期 | 入力パネル（「ニックネームまたはアプリ名 *」「用途・キーワード」「希望 TLD」（複数選択、既定: 全対応 TLD）「候補を考える」）+ Empty State（案内）+ 直接検索カード | Input, Button, Empty State, Card |
| S-21 | `/domains/new` | AI 生成中 | ボタン「考え中…」Disabled、Skeleton Card ×6、注記「最大 20 秒」。完了で S-22、20 秒超 / `AI_UNAVAILABLE` / `RATE_LIMITED` で S-23 | Skeleton |
| S-22 | `/domains/new` | 候補表示 | Candidate Card ×6。各カード: ドメイン名（TLD はブランド色）/ Rarity / Score Gauge（クリックで最も近い既存名 3 件と類似度を展開 = Similarity Row ×3）/ 理由（40 字、Caption）/ 空きバッジ / 操作。「登録へ」→ S-25、「もう一回考える」→ S-21（前回候補を除外）、「自分で入力して探す」→ S-24 | Candidate Card, Score Gauge, Similarity Row |
| S-23 | `/domains/new` | AI エラー（AC-04-2） | Banner Warn。`REGISTRY_TIMEOUT`→「AI が 20 秒以内に応答しませんでした」、`AI_UNAVAILABLE`→「AI が利用できません。手入力で探せます」、`RATE_LIMITED`→「利用上限に達しました。n 秒後に再試行」。直接検索へ誘導。AI ログに記録 | Banner |
| S-24 | `/domains/new` | 直接検索の結果 | S-20〜S-23 と同一 URL（直接検索カードの開閉と結果表示のみが変わる）。検索条件・結果は URL に載らない（画面内 state のため、リロード・URL 共有では復元されない）。入力は `SLD + TLD 複数選択` または FQDN（`.` を含む場合は FQDN として 1 件で check）。結果は Search Result Row（Available / Taken / Error）。読み込み中は行ごとに Skeleton + レジストリ名。部分失敗は「確認不可」+ 注記（AC-03-2）。「登録へ」→ S-25、「代替を見る」→ 別 TLD・綴り違いを展開、「再試行」→ 当該レジストリのみ再 check | Search Result Row, Score Gauge, Rarity |
| S-25 | `/domains/new`（dialog） | 登録ダイアログ | Dialog / Register：空き（再確認済み）+ スコア + レア度（ゲージクリックで内訳）→ 期間 Select（helper に税込合計）→ NS・コンタクトは読み取り専用の説明のみ（**NS は `create` に送らない**ので helper は「登録時は未設定。あとから「情報修正」で設定できます」。ドパ民 DNS（`DOPAMIN_NAMESERVERS`）は FR-13 の反映時に切り替える NS で、登録時の既定値ではない）→ 「お支払いへ」→ S-29。直前に check 再実行 | Dialog / Register |
| S-29 | `/domains/new`（dialog） | お支払い（FR-19・モック） | 同じ Dialog 内でステップ切替。ご注文内容（Card + Key Value Row：品目 / 期間 / 単価 / 小計 / 消費税 10% / 税込合計 + Badge「固定ダミー価格」）→ カード入力（番号 / 有効期限 / CVC / 名義。デモ用カードが入力済み・AC-19-4）。「¥n を支払って登録する」→ 決済成立で `create` → S-26 /「戻る」→ S-25。入力エラーは欄ごとの warn helper、拒否は Banner Warn「お支払いに失敗しました」でダイアログは開いたまま（AC-19-3。`create` は呼ばない）。末尾 `0002` のカードで拒否を再現 | Dialog / Form, Card, Key Value Row, Input, Banner, Badge |
| S-26 | `/domains/new`（dialog） | 登録成功 | Dialog / Success：状態・有効期限・**実際の NS**（`domain.nameservers` が空なら「ネームサーバーは未設定（あとから設定できます）」）に加えお支払いの控え（金額・ブランド・下 4 桁・受付番号・モックである旨）。「サブドメイン設計に進む」→ S-40（登録直後は設計なし）、「詳細を見る」→ S-30。閉じた場合は元の S-22 / S-24 に戻り、当該カードは Taken（「取得しました → 詳細」）に更新。一覧は即時反映（AC-06-1） | Dialog / Success |
| S-27 | `/domains/new`（dialog） | 取得済み（CONFLICT 409） | 汎用 Dialog：直前の再確認で他者取得。代替候補 3 件を本文に列挙、「代替候補を見る」→ S-24 | Dialog |
| S-28 | `/domains/new`（dialog） | create タイムアウト（AC-06-2） | 汎用 Dialog：再送せず `info` で照合。結果 4 分岐: 登録済み → S-30 / 空きのまま → S-25 に戻り Banner Info「登録は行われていません」（本文は「お支払いは確定していません。もう一度お支払いに進めば再送できます」・再送可）/ 他者取得 → S-27 / 照合失敗 → S-28 のまま Error Card + 「もう一度確認」 | Dialog, Error Card |

**Rarity とスコアラベルの対応（FR-05）**

| Rarity | 条件 | 表示 |
|---|---|---|
| SSR | 空き かつ `high`（≥70） | グラデーション文字、枠 Brand |
| R | 空き かつ `medium`（40–69） | link 色 |
| N | 空き かつ `low`（<40） | muted。空きバッジは Warn「紛らわしい」、CTA は Subtle「それでも登録」 |
| Taken | 取得済み | Rarity 非表示、Badge Muted Solid「取得済み」、代替候補を注記 |
| Unknown | check 失敗（AC-03-2 / AC-05-2） | スコアは表示、Badge Warn「確認不可」、「再試行」（当該候補のみ再 check）、「登録へ」なし |

6 件すべてが Unknown（両レジストリ停止）のときは候補グリッド上部に Banner Warn を追加する。

### 2.4 ドメイン詳細（FR-07〜12）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-30 | `/domains/[name]` | Active | ヘッダー（ドメイン名 + 状態バッジ + ロックバッジ + 最終同期 / 再同期）。基本情報カード: レジストリ / EPP ステータス一覧（バッジ + 日本語説明ツールチップ）/ 登録日 / 有効期限（残日数 + 進捗）/ Grace Period（Renew / Transfer / Auto-Renew GP は種別と残日数を表示のみ）/ 移管可能日（ツールチップ「ICANN 実運用の参考。可否判定には使いません」）。ネームサーバー / コンタクト / サブドメイン設計カード（`反映済み n / m`、未作成時は「未作成 → 設計をはじめる」）。右: 操作パネル（更新 / 情報修正 / 移管 OUT / 廃止 / 復旧 + 移管ロックの ON / OFF 表示。切り替えは D-02 で行う）。コンタクトカードの登録者・メールは API の `registrantProfile` から出し、アプリのコンタクトを参照していないドメイン（移管 IN 直後など）は「未取得」と書く（コンタクト ID は出さない）。不可操作は Disabled + 理由（AC-07-1） | Card, Key Value Row, Progress Bar, Badge, Button |
| S-31 | `/domains/[name]` | info 失敗（AC-07-2） | Banner Warn + キャッシュ表示（最終同期時刻）。操作ボタンは全て Disabled、「再同期」で S-35 → 成功なら S-30 | Banner |
| S-32 | `/domains/[name]` | 移管申請を受信（AC-07-3） | Banner Warn + 状態バッジ「移管中（申請受信）」。操作パネル先頭に「拒否」「承認」+「自動承認まで mm:ss」（1 秒更新）。他操作は Disabled。タイマーが 0 になったらボタンを Disabled にし「状態を確認中…」→ 再照会 → S-34 | Banner, Button |
| S-33 | `/domains/[name]` | 復旧猶予（RGP・`redemptionPeriod`） | Banner Info「残り n 日」、バッジ「復旧猶予 残 n 日」。操作は「復旧する」のみ有効 → D-04。EPP ステータス欄に `pendingDelete` が並んでいても（RGP 中は必ず共存する）S-36 ではなくこちら | Banner, Badge |
| S-34 | `/domains/[name]` | 移管済み（AC-12-5） | バッジ「移管済み」、操作パネルなし、Banner Info「表示のみ」。自ユーザーの `transferred_out` 行のみ | Banner |
| S-35 | `/domains/[name]` | 読み込み | Skeleton。`info` 取得後 S-30 | Skeleton |
| S-36 | `/domains/[name]` | 削除待ち（`redemptionPeriod` を伴わない `pendingDelete`） | バッジ「削除待ち」、Banner Warn「完全削除まで残り n 日」。操作パネルなし（復旧ボタンは表示しない・AC-11-2）。`redemptionPeriod` が付いている間は S-33 | Banner, Badge |
| S-37 | `/domains/[name]` | 停止中（`clientHold` / `serverHold`） | バッジ Warn「停止中」、Banner Warn「名前解決されません。運営の案内を確認」。更新・情報修正は可 | Banner, Badge |
| S-38 | `/domains/[name]` | NS 未設定（`inactive`） | バッジ「NS 未設定」、Banner Info + CTA「NS を設定」→ D-02。NS カードは「—（未設定）」 | Banner, Button |
| S-39 | `/domains/[name]` | コンタクト未移行（移管 IN 後） | Banner Warn「登録者情報が旧レジストラのままです」+ CTA「情報修正」（登録者プロファイルへ差し替えを再実行）。要確認 #14 が解決するまでの暫定表示 | Banner |
| D-01 | dialog | 更新（FR-08） | Dialog / Form：期間 Select + Helper に新しい有効期限と税込合計。合計 10 年超は送信前に弾く（AC-08-2）。「お支払いへ」→ D-11 | Dialog / Form, Input |
| D-11 | dialog | 更新のお支払い（FR-19・モック） | S-29 と同じ構成（ご注文内容 + カード入力）。「¥n を支払って延長する」→ 決済成立で `renew` → S-30 + Banner Ok（金額・受付番号つき）/「戻る」→ D-01。拒否時は `renew` を呼ばずダイアログ内に Banner Warn（AC-19-3）。レジストリ側の失敗は従来どおり D-07 | Dialog / Form, Card, Key Value Row, Input, Banner, Badge |
| D-02 | dialog | 情報修正（FR-09） | Dialog / Form：NS 2〜13 件（追加行）。コンタクト（登録者必須・技術任意）は同ダイアログのセクション。氏名・メールはレジストリが許可するダミー値のみで、送る前にその場で弾く（`ALLOWED_CONTACT_NAMES` の 8 種 / `@example.com` `.net` `.org`）。`street` / `city` / `countryCode` は入力欄を持たず `DEFAULT_REGISTRANT_PROFILE` で補う。移管ロックは同ダイアログのトグル（`clientTransferProhibited` の付け外し）で、`serverUpdateProhibited` / `serverTransferProhibited` 中は Disabled + 理由（AC-09-2）。送るのは**変更した項目だけ**（解除だけの要求を API の `unlockOnly` 経路に乗せるため。何も変えていなければ NS を送る）。成功 → S-30 + Banner Ok | Dialog / Form |
| D-03 | dialog | 廃止（FR-10） | Dialog / Danger：ドメイン名再入力が一致するまで「廃止する」Disabled。AGP 内（登録後 5 日）は見出し・本文を「無課金で取消扱い」に切替。成功 → RGP 入り: S-33 / 即時削除: S-10 + Banner Ok「example.com を取り消しました」 | Dialog / Danger |
| D-04 | dialog | 復旧（FR-11） | 汎用 Dialog：費用（ダミー、`RESTORE_FEE`）と復旧後の状態を明示。お支払いステップは挟まない（`docs/specs/payment-mock.md` §8 #2）。成功 → S-30 + Banner Ok | Dialog |
| D-05 | dialog | AuthCode 発行（FR-12） | Dialog / Form：Code Block + コピー、「再発行」。注意文「発行すると以前のコードは使えなくなります」。値は保存せず操作ログはマスク。再入力は不要（§7-4） | Dialog / Form, Code Block |
| D-06 | dialog | 移管承認 / 拒否 | 承認: Dialog / Danger（ドメイン名再入力で解錠、§15.2）。本文に自動承認までの残り時間。承認 → S-34 + Banner Ok / 拒否 → S-30 + Banner Ok「拒否しました」。期限超過後は Error Card「既に自動承認されました」→ S-34 | Dialog / Danger, Dialog |
| D-07 | 画面内 | レジストリ拒否 | Error Card（`OPERATION_NOT_ALLOWED` / `REGISTRY_REJECTED`）をメイン先頭に。Server ステータス優先の理由を本文に | Error Card |

### 2.5 サブドメイン設計（FR-13）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-40 | `/domains/[name]/subdomains` | 初期（`GET …/subdomain-plan` が 404） | ヘッダー（「設計を保存」「DNS に反映」Disabled）+ リポ URL 入力 + Empty State（案内）。S-26 / S-30 からの入口で保存済み設計が無い場合 | Input, Empty State |
| S-40b | 同上 | 読み込み | 保存済み設計の取得中 Skeleton（`GET …/subdomain-plan`）。あれば S-43。Figma フレームなし（§4 の読み込み規則で表現） | Skeleton |
| S-41 | 同上 | 解析中 | ボタン「解析中…」Disabled、Skeleton。GitHub 404 / 非公開 → S-42、AI 失敗（`AI_UNAVAILABLE` / timeout 30 秒）→ S-40 に戻り Banner Warn + 再試行 | Skeleton |
| S-42 | 同上 | リポ取得失敗（AC-13-2） | Empty State Warn + 「プロジェクト概要」入力 → 「概要から提案」。GitHub レート制限（`RATE_LIMITED`）も同画面で文言差し替え | Empty State, Input |
| S-43 | 同上 | 提案・編集（保存済み設計あり） | ツリー（Tree Root / Node with Show Status: 反映済み / 変更あり / 未反映）+ 編集パネル + 「DNS 反映」セクション + 手動設定用 Code Block | Tree Node, Card, Input, Badge, Code Block |
| S-44 | 同上（dialog） | 反映確認（AC-13-7） | Dialog / Apply DNS：件数チップ → DNS Diff Row → NS 状態 → 「n 件を反映する」。キャンセル / Esc で S-43 に戻る（変更なし） | Dialog / Apply DNS, DNS Diff Row |
| S-45 | 同上 | 反映後（AC-13-4） | Banner Ok、全ノード「反映済み」、CTA「反映済み — 差分なし」Disabled | Banner |
| S-46 | 同上 | NS 切替失敗（AC-13-5） | Banner Warn、NS バッジ Warn「未切替 — 反映時に切り替えます」、レコード未変更 | Banner, Badge |

### 2.6 移管（FR-12）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-50 | `/transfers` | 一覧 | Page Header（件数、「状態を更新」= Poll 消化 + transferQuery）+ 移管 IN フォーム + セクション: 受信した申請（Out Received: 拒否 / 承認 + 残り時間）/ 申請中（In Pending: 状態を確認 / 取消、Import Pending: 承認済み・取り込み待ち + 再試行）/ 履歴（approved OUT の行 → S-34、取り込み完了 → S-30 + Banner Ok「取り込みました」） | Transfer Item, Card, Input |
| S-51 | `/transfers` | 0 件 | フォーム + Empty State | Empty State |
| S-52 | `/transfers` | 申請エラー（AC-12-2） | フォーム下に Error Card（`REGISTRY_REJECTED · 2202` など、Show Retry なし）。移管ロック中・pendingTransfer 中・未登録も同型で文言差し替え | Error Card |
| S-53 | `/transfers` | 更新エラー（FR-18） | Banner Warn + キャッシュ表示。承認 / 拒否 / 取消 / 申請は Disabled | Banner |
| D-08 | dialog | 取消（P1） | 汎用 Dialog「取り消す」→ S-50 + Banner Ok | Dialog |

### 2.7 ログ（FR-14 / 15）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-60 | `/logs`（S-70 の「開発者向け」から入る） | 操作ログ | Tabs（操作ログ / AI ログ、件数バッジ）+ Log Row（Kind=Operation: 日時 / コマンド / レジストリ / 対象 / 結果コード / レイテンシ）。行クリックで Log Detail（request / response、マスク済み）を展開 | Tabs, Log Row, Log Detail |
| S-61 | `/logs?tab=ai` | AI ログ | Log Row（Kind=AI: 機能 / プロバイダ・モデル / 入力要約 / 結果 / レイテンシ）。クリックで出力要約 + トークン数 + 生 JSON | Log Row |
| S-62 | `/logs` | 0 件 | Empty State | Empty State |
| S-63 | `/logs` | 読み込み / 取得失敗 | Skeleton 行 ×6 / Banner Warn + 再試行。Figma フレームなし（§4 の規則で表現） | Skeleton, Banner |

### 2.8 設定（FR-01 / 16 / 17）

| ID | ルート | 状態 | 表示 / 振る舞い | 使用コンポーネント |
|---|---|---|---|---|
| S-70 | `/settings` | 通常 | テーマ（Segmented Medium）、パスキー管理（一覧: 名前 / 作成日 / 最終利用日 + 追加 + 削除。最後の 1 つは Disabled）、AI 設定（プロバイダ / モデル Select。選択肢の取得は §7-2）、**開発者向け**（ログ → S-60、デモデータリセット。表示条件は §7-3） | Segmented Control, Card, Input, Button |
| S-70b | `/settings` | パスキー追加失敗 / AI 設定保存 | Banner Warn「パスキーを追加できませんでした」/ Banner Ok「AI 設定を保存しました」。Figma フレームなし（S-71 と同型） | Banner |
| D-09 | dialog | パスキー削除 | 汎用 Dialog。最後の 1 つは API が 409（UI では事前に Disabled） | Dialog |
| D-10 | dialog | デモリセット（FR-16） | Dialog / Danger：「reset」再入力で解錠 | Dialog / Danger |
| S-71 | `/settings` | リセット完了 | Banner Ok | Banner |

### 2.9 システム

| ID | ルート | 状態 | 表示 / 振る舞い |
|---|---|---|---|
| S-80 | `*`（404 / 403） | Not Found / Forbidden | Top Bar + Empty State Neutral「ページが見つかりません」+ 「ダッシュボードへ」 |
| S-81 | error boundary（500） | Internal Error | Empty State Warn + Error Card（`INTERNAL` / 500 / request ID）。「再読み込み」 |

## 3. 画面遷移

Figma **Prototype / Screens** にプロトタイプ接続を設定済み（Present で操作可）。開始点は S-00 と S-10。

```
認証
  S-00 ─パスキーではじめる─▶ S-01 ─作成成功─▶ S-11（初回）/ next
  S-00 ─ログイン─▶ S-02 ─成功─▶ S-10 / next      S-02 ⇄ S-01
  未認証アクセス ─▶ S-02（?next=）   API 401 ─▶ S-03（?reason=expired&next=）

サイドバー（全画面共通）
  ダッシュボード → S-10 / 移管 → S-50 / 設定 → S-70
  「+ ドメインを取得」→ S-20 / ログアウト → S-02 / テーマトグル → Color モード切替

ダッシュボード
  S-10 カード: 詳細 → S-30 / 今すぐ更新 → D-01（成功 → S-10 再取得 + Banner Ok）/ 復旧する → D-04（同上）
              / 状態を確認 → S-50 / NS を設定 → D-02 / 最新化 → S-12 → S-10（失敗 → S-13）
  S-11: ドメインを取得 → S-20 / 移管で持ち込む → S-50
  S-13: 更新系カード操作は Disabled、最新化で再試行

ドメイン取得
  S-20 ─候補を考える─▶ S-21 ─(≤10s)─▶ S-22 / ─(timeout・AI_UNAVAILABLE・RATE_LIMITED)─▶ S-23
  S-20 / S-23 ─空きを確認─▶ S-24
  S-22 / S-24 ─登録へ─▶ S-25 ─お支払いへ─▶ S-29 ─支払って登録する─▶ S-26 ─設計に進む─▶ S-40 / ─詳細を見る─▶ S-30 / ─閉じる─▶ 元画面（カードは Taken）
                                    │              └─決済拒否─▶ S-29（Banner Warn。create は呼ばない）
                                    └─戻る─▶ S-25
                                                   └─409─▶ S-27 ─代替候補を見る─▶ S-24
                                                   └─timeout─▶ S-28 ─▶ S-30（登録済み）/ S-25（空きのまま）/ S-27（他者取得）/ S-28（照合失敗）

ドメイン詳細
  S-30 ─更新─▶ D-01 ─お支払いへ─▶ D-11 ─支払って延長する─▶ S-30 + Banner Ok / ─決済拒否─▶ D-11 / ─戻る─▶ D-01
       ─情報修正─▶ D-02 / ─廃止─▶ D-03 / ─移管OUT─▶ D-05 / ─開く─▶ S-43（設計あり）or S-40（なし）
       ─再同期─▶ S-35 ─▶ S-30（失敗: S-31）
  D-03 ─廃止する─▶ S-33（RGP）/ S-10 + Banner Ok（AGP 即時削除）
  S-32 ─承認─▶ D-06 ─承認する─▶ S-34 + Banner Ok      S-32 ─拒否─▶ D-06（拒否）─▶ S-30 + Banner Ok
  S-33 ─復旧する─▶ D-04 ─▶ S-30      S-38 ─NS を設定─▶ D-02      S-39 ─情報修正─▶ D-02

サブドメイン設計
  S-40 ─リポジトリを解析─▶ S-41 ─(≤15s)─▶ S-43 / ─404─▶ S-42 ─概要から提案─▶ S-41 / ─AI 失敗─▶ S-40 + Banner Warn
  S-43 ─DNS に反映─▶ S-44 ─n 件を反映する─▶ S-45 / ─NS 失敗─▶ S-46      S-44 ─キャンセル / Esc─▶ S-43
  S-43 ─設計を保存─▶ S-43（該当ノードが「変更あり」）

移管
  S-50 ─承認 / 拒否─▶ D-06 / ─取消─▶ D-08 ─▶ S-50 / ─申請─▶ S-50（受理・In Pending 追加）/ S-52（拒否）
  S-50 ─状態を更新─▶ S-50（失敗: S-53）   履歴（OUT approved）─▶ S-34   Import Pending ─取り込み完了─▶ S-30 + Banner Ok

ログ / 設定
  S-70 ─開発者向け「ログを開く」─▶ S-60 ⇄ S-61（タブ）
  S-70 ─削除─▶ D-09 ─▶ S-70 / ─リセット実行─▶ D-10 ─▶ S-71
```

## 4. 状態表示の規則

| 状況 | 表示 | 補足 |
|---|---|---|
| 読み込み（初回） | Skeleton（形は実コンテンツに合わせる） | 300ms 未満で終わる場合は出さない。DB キャッシュがあるものはキャッシュを先に描画 |
| 読み込み（操作中） | ボタンを Disabled + ラベルを「〜中…」に | 二重送信防止。更新系はタイムアウト後に `info` で照合し、結果が出るまで Disabled を維持 |
| 0 件 | Empty State Neutral + 次の行動の CTA | 本文は 1〜2 文。専門用語は日本語ラベル |
| 参照系エラー | Banner Warn（画面内・キャッシュ表示を継続）+ 再試行 | 自動再試行 2 回（指数バックオフ）の後に表示。レジストリ単位の部分失敗は影響する行 / カードだけ「未同期」表示（S-13） |
| 更新系エラー | Error Card（code / HTTP / request ID）または汎用 Dialog | 「ローカルの情報は変更されていません」を必ず含める（FR-18） |
| バリデーション | Input の Helper を Caption Warn 色に切替（クライアント + サーバー） | RFC 1035（AC-03-3）、表示名 1〜32 文字、期間 1〜10 年 |
| 成功 | Banner Ok をメイン先頭に、または Dialog / Success | 一覧・詳細は即時再取得して反映 |
| カウントダウン | 自動承認までの残り時間は `mm:ss` で 1 秒更新 | 0 到達で操作を Disabled にし再照会（S-32） |

エラーコードと文言の対応（§10.3）:

| code | 文言（例） | 次の行動 |
|---|---|---|
| `VALIDATION_ERROR` | 入力内容を確認してください（フィールド下に詳細） | 修正して再送 |
| `UNAUTHORIZED` | セッションの有効期限が切れました | S-03 |
| `FORBIDDEN` / `NOT_FOUND` | ページが見つかりません | S-80 |
| `CONFLICT` | 取得済み / 最後のパスキーは削除できません | S-27 / D-09 を閉じる |
| `OPERATION_NOT_ALLOWED` | 〜ロック中のため実行できません（`details.statuses`） | ボタン Disabled + 理由（D-07） |
| `REGISTRY_REJECTED` | Kitaqsign が拒否しました（2202: AuthCode が正しくありません 等） | 文言差し替え + 再入力（S-52） |
| `REGISTRY_TIMEOUT` | Kitaqsign が応答しませんでした | 参照系: 再試行 / 更新系: 結果を確認（S-28） |
| `REGISTRY_UNAVAILABLE` | Kitaqsign に接続できません | しばらくして再試行 |
| `REGISTRY_SPEC_MISMATCH` | レジストリの仕様変更の可能性があります | 操作ログを見る |
| `AI_UNAVAILABLE` | AI が利用できません。手入力で探せます | S-23 / S-40 + Banner |
| `RATE_LIMITED` | 利用上限に達しました。n 秒後に再試行してください | 再試行ボタンを n 秒 Disabled |
| `INTERNAL` | エラーが発生しました（request ID） | S-81 |

## 5. アクセシビリティ・モーション

- コントラスト: 本文 ≥ 4.5:1（標準・極ドパとも検証済み）。ブランドグラデーション上の白文字は 4.6〜5.7:1。
- フォーカス: `:focus-visible { outline: 2px solid var(--color-brand-1); outline-offset: 2px }`。ダイアログはフォーカストラップ + Esc で閉じる（閉じても状態は変えない）。
- 極ドパの RGB グラデーションアニメーションとグローは `prefers-reduced-motion: reduce` で停止（NFR-08）。Skeleton のシマーも同様。
- 破壊的操作（廃止・デモリセット・移管 OUT の承認）はドメイン名 / `reset` の再入力（§15.2）。AuthCode の発行は再入力なし（§7-4）。
- 専門用語（EPP ステータス・RGP・AuthCode）はバッジに日本語ラベル + ツールチップで英語名。

## 6. 実装メモ

- ルーティング: Next.js App Router。ダイアログは URL を変えないモーダル。戻る操作はページ遷移として扱う（ダイアログは Esc / キャンセルで閉じる）。
- 状態管理: 画面ごとに `loading | ready | empty | error` の判別共用体。`error` は §10.3 の `code` を保持し、上表の文言に変換する `apps/web/lib/error-messages.ts` を 1 か所に置く。
- Domain Card / 詳細の状態は `packages/shared` の `deriveDisplayStatus` の戻り値をそのままバリアント名にマッピングする（UI 側で EPP ステータスを再解釈しない）。
- 数値表示: 残り時間（自動承認）は `mm:ss` で 1 秒更新、残日数は日単位。
- テーマ: `<html data-theme="standard|goku">` で CSS 変数を切替。Figma の Color モードと 1:1。
- テスト観点: 各 `S-xx` の状態を Storybook / Playwright の fixture 名にする（例 `dashboard/sync-error`）。

## 7. 要確認（requirements.md 側の決定が必要）

`spec-change-guard` に従い、以下は本書では仮置きとし、決定後に requirements.md を更新する。

| # | 事項 | 本書の仮置き | 選択肢 |
|---|---|---|---|
| 1 | S-00 のお試しスコアが `POST /domains/check`（認証要）を未認証で呼べない | 「ログイン後に利用可」と表示し、入力欄は Disabled | (a) 未認証可の `POST /uniqueness/preview`（レート制限付き）を §10.1 に追加 (b) お試しスコアを削除 |
| 2 | ~~FR-17 の選択肢（有効プロバイダ / モデル）を取得する API が §10.1 にない~~ → 解決（requirements v0.1.8）: `GET /auth/me` の `ai: { provider, model, providers[] }` で配る | `GET /auth/me` に含める | 済 |
| 3 | ~~FR-16 `DEMO_RESET_ENABLED` をクライアントが知る手段~~ → 解決（requirements v0.1.8）: `GET /auth/me` の `features.demoReset`。false ならカード非表示 | `GET /auth/me` に含める | 済 |
| 4 | §15.2「移管 OUT はドメイン名再入力」の適用範囲 | 承認（D-06）で再入力、AuthCode 発行（D-05）は不要 | D-05 にも再入力を課す |
| 5 | FR-10 AGP 即時削除後の DB 行の扱い | 行を削除し S-10 へ（詳細 URL は S-80） | `pendingDelete` 表示で残す |
| 6 | NFR-09 / §15.4 のモバイル対応 | 本書が状態を書き下すのはデスクトップ（最大 1280px）のみ。`md` 未満は `MobileNav`（横ナビ）+ 1 列グリッドで実装済み（`apps/web/components/app/mobile-nav.tsx`、`sm` 2 列 / `2xl` 3 列） | 要件をデスクトップ限定に改訂 / 375px の主要 4 画面を追加 |
| 7 | 移管 IN 取り込み後のコンタクト差し替え失敗時の UI（要確認 #14） | S-39 のバナー + 情報修正で再実行 | — |

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-08-26 | 初版。requirements v0.1.5 の全 FR を画面 × 状態（54 フレーム）に展開し、Figma Prototype ページと対応付け |
| v0.2 | 2026-08-26 | 網羅性レビュー（38 件）を反映: Domain Card の Status を §9.2 と 1:1 化、S-36〜39 / S-02c / S-53 / S-40b / S-63 / S-70b を追加、Rarity ↔ FR-05 ラベル対応表、直接検索の複数 TLD / FQDN、S-26 → S-40、S-28 / D-03 / D-06 の分岐、認証リダイレクト規則、エラーコード表に 5 コード追加、§7 要確認 7 件 |
| v0.3 | 2026-08-26 | S-13 を `POST /domains/sync` の部分失敗契約（200 + `failures[]`、PR #136）に合わせて更新。§7 #2 / #3 は requirements v0.1.8 で解決 |
| v0.4 | 2026-08-26 | FR-19（requirements v0.1.11）のモック決済を反映: **S-29**（登録のお支払い）/ **D-11**（更新のお支払い）を追加、S-25 / D-01 の主ボタンを「お支払いへ」に変更、S-26 の本文に支払い控え、S-28 の Banner 本文を支払い前提に更新、D-04 に `RESTORE_FEE` 参照を明記、遷移図に決済分岐を追加。詳細は `docs/specs/payment-mock.md` |
| v0.5 | 2026-08-27 | 実装との乖離を修正: §1 の幅 / サイドバーを実装の 1280px / 224px（rem 基準・大画面で font-size 拡大）と `MobileNav` に合わせ、S-24 のルートを `/domains/new`（検索条件は URL に載らない）に訂正、S-10 / S-13 / §4 の「Stale」を実装の「未同期」バッジ表記に統一、§7 #6 の仮置きを現状に更新 |
| v0.6 | 2026-08-27 | AI の時間制限の緩和（requirements v0.1.22）に追随: S-21 / S-23 の「10 秒」を「20 秒」、S-41 の「15 秒」を「30 秒」に更新。画面と状態そのものは変えていない |
| v0.7 | 2026-08-27 | S-13 の Banner を `failures[].code` で出し分ける仕様に更新（#184）。固定文言だと `NOT_FOUND` などレジストリ障害でない失敗まで「〇〇が応答しません」と出て切り分けが空振りするため。画面と状態そのものは変えていない |
| v0.8 | 2026-08-27 | 文言と実結果の不一致を修正（#173）: S-25 の NS helper から実際には適用されない `DOPAMIN_NAMESERVERS` を外し、S-26 は実際の `nameservers` を出す（空なら「未設定」）、D-03 の AGP 分岐の注記から「即時に削除され、元に戻せません」の断定を外す（採番が衝突していたため v0.6 から採り直した）|
| v0.9 | 2026-08-27 | RGP の状態を requirements v0.1.23 に追随（#171）。S-33 / S-36 / §2.2 の Status 表を「RGP 中は `pendingDelete` が共存する」前提に直し、S-36 の対象を「`redemptionPeriod` を伴わない `pendingDelete`」に限定した（採番が衝突していたため v0.6 から採り直した）|
