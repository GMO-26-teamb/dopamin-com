# FE（apps/web）UI 実装 設計書 — モックで全画面、Backend Ready

| 項目 | 内容 |
|---|---|
| 版 | v1（2026-08-26） |
| 入力 | `docs/specs/ui-screens.md` v0.2（全 60 画面・状態）、Figma `UI Design (Team B)`（file `3gv0voomQ7jVtBzVUbnoZj`）、`docs/requirements.md` v0.1.5 |
| ゴール | Figma プロトタイプの全画面を `apps/web` に実装し、データ取得を **Service インターフェース** の裏に隠す。既定はモック実装で全状態（通常 / 空 / 読み込み / エラー）を再現でき、API が揃ったら HTTP 実装に差し替えるだけで済む状態にする |
| 非ゴール | API（apps/api）の追加実装、DB、本物の DNS。モバイル対応（ui-screens §7-6）。Storybook |

## 1. 判断（ブレスト結果）

| 論点 | 決定 | 理由 |
|---|---|---|
| UI 基盤 | 自前の `components/ui/*`（shadcn 流儀: `radix-ui` + `cva` + `tailwind-merge`）。shadcn CLI は使わない | Modernist DS（角丸 0・2px 罫線・左揃え）を Figma トークンで忠実に出す。CLI 生成物の rounded/shadow 前提を剥がすより速い |
| スタイル | Tailwind v4 CSS-first。`tokens.css` を Figma 変数から生成し、`@theme` で `bg-panel` `text-muted` `border-line` 等のユーティリティにする | Figma の code syntax（`var(--color-bg)` …）とクラス名を 1:1 に保つ |
| テーマ | `<html data-theme="standard|goku">` を `ThemeProvider` が制御（localStorage `dopamin-theme`）。OS の dark は無視 | 製品仕様が「極ドパモード」トグル（FR-17 ではなく UI 設定） |
| データ取得 | `lib/api/services.ts` のインターフェース + TanStack Query hooks。実装は `mock/`（既定）と `http/`（Hono RPC）を `NEXT_PUBLIC_API_MODE` で切替 | 画面はインターフェースにだけ依存。BE が来たら `http/` を埋めるだけ |
| モック状態切替 | URL `?mock=<scenario>`（`empty` / `loading` / `error` / 機能固有）を `MockScenarioProvider` が読み、モック実装に渡す | レビュー・デモで全状態を URL で再現。本番ビルドでは無視 |
| 認証（モック時） | `proxy.ts` は `NEXT_PUBLIC_API_MODE=mock` のとき Cookie チェックをスキップ。`AuthService` モックは常にログイン済みユーザーを返す | パスキーの実 API は既存の `lib/webauthn.ts` を `http/` 実装から使う |
| 状態の導出 | `deriveDisplayStatus` を `packages/shared` に実装し、UI は EPP ステータスを再解釈しない（ui-screens §6） | Domain Card / 詳細のバリアントの SSOT |
| テスト | vitest + jsdom + Testing Library。共有ロジック・モックサービス・状態分岐を持つコンポーネントを対象。見た目だけのコンポーネントは snapshot しない | `pnpm check` に web の test を追加 |
| motion | `motion`（旧 framer-motion）。候補カードのスタガー・ゲージのカウントアップ・パネルのスライドイン。`useReducedMotion` で無効化 | 要件 §15.3 |

## 2. ディレクトリ構成（apps/web）

```
app/
  layout.tsx                  next/font（Noto Sans JP / Archivo / Yuji Boku / JetBrains Mono）、ThemeProvider、Providers
  globals.css                 @import tailwindcss + tokens.css、@theme、base、テキストユーティリティ
  tokens.css                  生成物（lib/theme/tokens.json → scripts/gen-tokens.ts）
  page.tsx                    S-00 ランディング
  (auth)/login/page.tsx       S-02 / S-02b / S-02c / S-03
  (auth)/signup/page.tsx      S-01 / S-01b / S-01c
  (app)/layout.tsx            AppShell（Sidebar + main + AI Log Panel）
  (app)/dashboard/page.tsx    S-10〜S-13
  (app)/domains/new/page.tsx  S-20〜S-28
  (app)/domains/[name]/page.tsx            S-30〜S-39 + D-01〜D-07
  (app)/domains/[name]/subdomains/page.tsx S-40〜S-46
  (app)/transfers/page.tsx    S-50〜S-53 + D-08
  (app)/logs/page.tsx         S-60〜S-62
  (app)/settings/page.tsx     S-70 / S-71 + D-09 / D-10
  (app)/settings/passkeys/page.tsx  → /settings へ redirect（既存 URL の互換）
  not-found.tsx               S-80
  error.tsx                   S-81
components/ui/                DS プリミティブ（Figma のコンポーネント名と 1:1）
components/app/               sidebar, nav-item, top-bar, page-header, theme-toggle, ai-log-panel, app-shell
features/<domain>/            画面固有の組み合わせ（domains / candidates / subdomains / transfers / logs / settings / auth）
lib/api/                      types.ts, errors.ts, services.ts, hooks.ts, provider.tsx, query-client.tsx, mock/*, http/*
lib/error-messages.ts         §10.3 code → 文言（ui-screens §4）
lib/theme/                    tokens.json, theme-provider.tsx, use-reduced-motion.ts
lib/utils.ts                  cn()
scripts/gen-tokens.ts         tokens.json → app/tokens.css
test/setup.ts, vitest.config.ts
```

## 3. トークンとテーマ

- `tokens.css` は `:root[data-theme="standard"]` / `:root[data-theme="goku"]` に Color を、`:root` に Dimensions / opacity / font を書く。`--gradient-brand: linear-gradient(90deg, var(--color-brand-1), var(--color-brand-mid), var(--color-brand-2))`、`--glow-brand: 0 0 12px var(--glow-1), 0 0 22px var(--glow-2)`。
- `globals.css` の `@theme inline` で `--color-bg` 等を Tailwind の色トークン名（`bg`, `panel`, `ink`, `muted`, `line`, `soft`, `brand-1`, `brand-mid`, `brand-2`, `warn`, `ok`, `link`, `link-hover`, `on-brand`, `track`, `hover`, `overlay`, `code-bg`, `code-fg`）に、`--font-jp` 等を `font-jp` / `font-latin` / `font-goku` / `font-mono` に、`--size-*` を `w-sidebar` 等で使える `--spacing-*` に写す。
- テキストスタイルは `@utility text-heading-page { font: 900 20px/28px var(--font-jp); }` のように 25 個のユーティリティとして定義する（`tokens.json.textStyles` から生成）。
- 角丸は常に 0（`rounded-none` を既定にし、`--radius-*` は使わない）。
- 極ドパの RGB アニメーション: `.gradient-animated` を `@media (prefers-reduced-motion: no-preference)` かつ `[data-theme="goku"]` でのみ動かす。

## 4. データ層（Backend Ready の要）

### 4.1 型（`lib/api/types.ts`）

`packages/shared` の `DomainInfo` / `AuthUser` / `PasskeySummary` / `ApiErrorBody` を再利用し、画面用の ViewModel を追加する。

```ts
import type { DisplayStatus } from "@dopamin/shared";

export type Ownership = "owned" | "transferred_out";

export interface DomainSummary {
  name: string; sld: string; tld: string; registry: "kitaqsign" | "kitaqnic" | "mock";
  statuses: string[]; rgpStatuses: string[]; ownership: Ownership;
  displayStatus: DisplayStatus;            // deriveDisplayStatus の結果（SSOT）
  registeredAt: string; expiresAt: string | null; rgpUntil: string | null;
  syncedAt: string; stale: boolean;         // 直近の sync に失敗したらキャッシュ表示
  transfer: { direction: "in" | "out"; actByAt: string } | null;
}
export interface GracePeriod { kind: "add" | "renew" | "transfer" | "autoRenew" | "redemption" | "pendingDelete"; until: string }
export interface DomainDetail extends DomainSummary {
  nameservers: string[];
  registrant: { name: string; email: string; migrated: boolean }; // migrated=false → S-39
  gracePeriods: GracePeriod[]; transferableFrom: string | null;
  subdomainPlan: { hosts: number; applied: number } | null;
}
export interface UniquenessScore { score: number; label: "high" | "medium" | "low"; nearest: { name: string; similarity: number }[] }
export type Availability = "available" | "unavailable" | "error";
export interface Candidate { sld: string; tld: string; reason: string; registry: DomainSummary["registry"]; availability: Availability; uniqueness: UniquenessScore | null; alternatives: string[] }
export interface SearchResult { name: string; sld: string; tld: string; registry: DomainSummary["registry"]; availability: Availability; uniqueness: UniquenessScore | null; alternatives: string[]; error: ApiErrorBody["error"] | null }
export type ApplyStatus = "applied" | "changed" | "pending";
export interface SubdomainHost { id: string; host: string; purpose: string; recordType: "A" | "CNAME" | "ALIAS"; target: string; priority: "required" | "recommended" | "optional"; applyStatus: ApplyStatus }
export interface SubdomainPlan { domain: string; repoUrl: string | null; policy: string; hosts: SubdomainHost[]; nameserversSwitched: boolean; savedAt: string | null; appliedAt: string | null }
export interface DnsRecord { host: string; recordType: SubdomainHost["recordType"]; target: string; ttl: number }
export interface DnsDiff { added: SubdomainHost[]; updated: { host: SubdomainHost; previous: DnsRecord }[]; removed: DnsRecord[]; unchanged: string[] }
export interface Transfer { id: string; domainName: string; registry: DomainSummary["registry"]; direction: "in" | "out"; status: "pending" | "import_pending" | "approved" | "rejected" | "cancelled"; requestedAt: string; actByAt: string | null; completedAt: string | null }
export interface OperationLog { id: string; at: string; command: string; registry: DomainSummary["registry"]; domainName: string | null; status: "success" | "error" | "timeout" | "spec_mismatch"; errorCode: string | null; registryCode: string | null; latencyMs: number; request: unknown; response: unknown }
export interface AiLog { id: string; at: string; feature: "domain_candidates" | "uniqueness" | "subdomain_plan"; provider: string; model: string; inputSummary: string; outputSummary: string; status: "success" | "error"; latencyMs: number; tokens: number | null; raw: unknown }
export interface AiSettings { provider: "google" | "anthropic"; model: string; providers: { id: "google" | "anthropic"; models: string[] }[] }
export interface Me { user: AuthUser; features: { demoReset: boolean }; ai: AiSettings }
```

### 4.2 サービスインターフェース（`lib/api/services.ts`）

```ts
export interface AuthService {
  isSupported(): boolean;
  signup(displayName: string): Promise<AuthUser>;
  login(): Promise<AuthUser>;
  logout(): Promise<void>;
  addPasskey(): Promise<PasskeySummary>;
  listPasskeys(): Promise<PasskeySummary[]>;
  deletePasskey(id: string): Promise<void>;
}
export interface DomainService {
  list(): Promise<DomainSummary[]>;                 // GET /domains（未実装 → NOT_IMPLEMENTED）
  sync(): Promise<DomainSummary[]>;                 // POST /domains/sync
  get(name: string): Promise<DomainDetail>;         // GET /domains/:name
  check(input: DomainCheckRequest): Promise<SearchResult[]>;   // POST /domains/check
  register(input: { name: string; period: number }): Promise<DomainDetail>; // POST /domains
  renew(name: string, input: { period: number }): Promise<DomainDetail>;
  update(name: string, input: { nameservers?: string[] }): Promise<DomainDetail>;
  remove(name: string): Promise<{ outcome: "rgp" | "deleted" }>;
  restore(name: string): Promise<DomainDetail>;
  authCode(name: string): Promise<{ authCode: string }>;
}
export interface CandidateService { generate(input: { nickname: string; purpose?: string; tlds?: string[]; exclude?: string[] }): Promise<Candidate[]> }
export interface SubdomainService {
  get(domain: string): Promise<SubdomainPlan | null>;
  propose(domain: string, input: { repoUrl?: string; description?: string }): Promise<SubdomainPlan>;
  save(domain: string, plan: SubdomainPlan): Promise<SubdomainPlan>;
  diff(domain: string): Promise<DnsDiff>;
  apply(domain: string): Promise<{ plan: SubdomainPlan; added: number; updated: number; removed: number; nameserversChanged: boolean }>;
}
export interface TransferService {
  list(): Promise<Transfer[]>; refresh(): Promise<Transfer[]>;
  request(input: { name: string; authCode: string }): Promise<Transfer>;
  approve(id: string): Promise<Transfer>; reject(id: string): Promise<Transfer>; cancel(id: string): Promise<Transfer>;
}
export interface LogService { operations(): Promise<OperationLog[]>; ai(): Promise<AiLog[]> }
export interface SettingsService { me(): Promise<Me>; updateAi(input: { provider: AiSettings["provider"]; model: string }): Promise<AiSettings>; demoReset(): Promise<void> }
export interface Services { auth: AuthService; domains: DomainService; candidates: CandidateService; subdomains: SubdomainService; transfers: TransferService; logs: LogService; settings: SettingsService }
```

### 4.3 エラー（`lib/api/errors.ts`）と文言（`lib/error-messages.ts`）

- `class ApiClientError extends Error { code: ErrorCode | "NOT_IMPLEMENTED" | "NETWORK"; retryable; registry?; registryCode?; requestId?; details? }`。HTTP 実装は §10.3 の JSON を zod（`apiErrorBodySchema`）で検証して変換。fetch 失敗は `NETWORK`。
- `toErrorCopy(err): { title: string; body: string; action: "retry" | "login" | "dashboard" | "none" }` — ui-screens §4 の表を 1 か所に。`registry` があれば文言に「Kitaqsign / Kitaqnic」を差し込む。

### 4.4 モック（`lib/api/mock/`）

- `fixtures.ts`: 決定的なデータ（ダッシュボード 4 件 = takutaku.com Active / harupika.xyz 残 23 日 / demo-app.online RGP / tkt-lab.net 移管中、候補 6 件、設計 4 ホスト、移管 3 件、ログ 5 + 4 件、パスキー 2 件）。日付は固定基準 `MOCK_NOW = 2026-08-26T10:00:00+09:00` からの相対で生成する。
- `mock-services.ts`: `createMockServices(scenario: MockScenario)`。状態はモジュール内の `MockStore`（in-memory）で保持し、`apply` / `save` / `renew` などが store を更新する。遅延 400ms（`loading` シナリオは 10 秒）。
- `scenario.ts`: `type MockScenario = "default" | "empty" | "loading" | "error" | "ai-timeout" | "partial-failure" | "stale" | "ns-fail" | "conflict" | "unsupported"`。`?mock=` から解決（不正値は `default`）。
- `provider.tsx`: `ServicesProvider` が `NEXT_PUBLIC_API_MODE`（`mock` 既定 / `http`）と scenario から `Services` を生成し context で配る。`useServices()`。

### 4.5 hooks（`lib/api/hooks.ts`）

TanStack Query。queryKey は `["domains"]`, `["domain", name]`, `["candidates", input]`, `["subdomain-plan", domain]`, `["transfers"]`, `["logs", "operations"]`, `["logs", "ai"]`, `["me"]`。mutation は成功時に関連 key を invalidate。`useDomains()` は `{ data, isPending, error, refetch }` をそのまま返す（画面側で `loading | empty | error | ready` に分岐）。

### 4.6 HTTP 実装（`lib/api/http/`）

`hc<AppType>("")` で同一オリジン `/api/v1/*` を叩く。存在するルート（check / register / get / renew / update / delete / restore / auth-code / transfers request+get、auth 系）は実装し、未実装（domains list / sync / candidates / subdomain-plan / logs / settings / transfers list・approve・reject・cancel）は `ApiClientError("NOT_IMPLEMENTED")` を投げる。各メソッドの上に要件 §10.1 のルートをコメントで書く。

## 5. UI プリミティブ（`components/ui`、Figma 名 1:1）

| コンポーネント | props / variants（cva） | Figma |
|---|---|---|
| Button | `variant: primary\|solid\|outline\|subtle\|danger`、`size: sm\|md\|lg`、`leadingIcon` / `trailingIcon`、`asChild`、`loading` | Button set `45:251` |
| IconButton | `variant: solid\|outline\|subtle`、`size: sm\|md`、`aria-label` 必須 | `45:301` |
| Badge | `tone: neutral\|ok\|warn\|muted\|brand`、`variant: outline\|solid`、`icon` | `44:48` |
| Rarity | `tier: SSR\|R\|N` | `44:62` |
| Input / Select | `label`、`helper`、`error`、`surface: bg\|panel`、`monospace`。Select は radix Select | `46:110` |
| SegmentedControl | 2 択、`size: md\|sm`、`value` / `onChange`、右側に Goku | `47:41` |
| Tabs | radix Tabs、下線アクティブ、`count` バッジ | `75:4453` |
| Dialog / FormDialog / DangerDialog / SuccessDialog | radix Dialog。Danger は `confirmText` 一致で解錠 | `53:10` `76:312` `76:360` `76:406` |
| Sheet | radix Dialog を右ドロワーに（AI Log Panel） | `77:124` |
| Tooltip | radix Tooltip | — |
| Skeleton | `shape: line\|block\|card` | `75:14` |
| Banner | `tone: ok\|warn\|info`、`title` / `body` / `onClose` / `action` | `69:60` |
| EmptyState | `tone: neutral\|warn`、`icon` / `title` / `body` / `primary` / `secondary` | `75:84` |
| ErrorCard | `error: ApiClientError`、`onRetry?`、`showLogsLink` | `75:87` |
| Card / KeyValueRow / Divider | `emphasis: default\|brand\|warn\|muted`、`kicker` / `title` | `50:31` `50:36` `50:41` |
| ProgressBar / ScoreGauge / SimilarityRow | `tone`、`value`（0–100）。Gauge は SVG arc + `motion` カウントアップ | `48:19` `48:40` `48:55` |
| CodeBlock | `code`、`copy` ボタン | `48:507` |
| Logo / Sticker / Goku / BrandBar | — | `43:6` `43:9` `43:15` `43:18` |

## 6. 画面ごとの状態分岐（ui-screens §2 と同じ ID）

各ページは `useXxx()` の `isPending / error / data` から `loading | error | empty | ready` を決め、`match` 的に分岐する。モックで各状態を出す URL:

| 画面 | 状態を出す URL |
|---|---|
| S-11 / S-12 / S-13 | `/dashboard?mock=empty` / `?mock=loading` / `?mock=stale` |
| S-21 / S-23 / S-24 Error | `/domains/new?mock=loading`（生成中 10 秒）/ `?mock=ai-timeout` / `?mock=partial-failure` |
| S-27 / S-28 | 登録ダイアログで `?mock=conflict` / `?mock=error` |
| S-31〜S-39 | `/domains/<name>`：fixtures の名前で状態を決める（`tkt-lab.net`=移管受信（S-32）、`demo-app.online`=RGP、`old-blog.xyz`=移管済み、`hold.example`=停止中、`inactive.example`=NS 未設定、`harupika.xyz`=コンタクト未移行（S-39）。§4.4 の fixtures と一致させる）。`?mock=stale` で S-31、`?mock=loading` で S-35 |
| S-40〜S-46 | `/domains/takutaku.com/subdomains`（設計あり = S-43）、`/domains/harupika.xyz/subdomains`（設計なし = S-40）、`?mock=error`（S-42）、`?mock=ns-fail`（S-46） |
| S-51〜S-53 | `/transfers?mock=empty` / 申請フォームに誤った AuthCode（`bad`）で S-52 / `?mock=error` で S-53 |
| S-62 | `/logs?mock=empty` |
| S-01c / S-02c | `?mock=unsupported` |

## 7. Figma ノード対応（get_design_context 用）

Prototype / Screens（Standard）: S-00 `80:2`、S-01 `80:40`、S-01b `80:52`、S-01c `80:92`、S-02 `80:168`、S-02b `80:179`、S-02c `93:7710`、S-03 `80:209`、S-80 `80:245`、S-81 `80:315`、S-10 `80:5548`、S-11 `80:5563`、S-12 `80:5653`、S-13 `80:5713`、S-20 `81:741`、S-21 `81:921`、S-22 `81:1008`、S-23 `81:1034`、S-24 `81:1156`、S-25 `81:1437`、S-26 `81:1531`、S-27 `81:1588`、S-28 `81:1663`、S-30 `83:2444`、S-31 `83:2497`、S-32 `83:2709`、S-33 `83:2959`、S-34 `83:3179`、S-35 `83:3348`、S-36 `93:7153`、S-37 `93:7322`、S-38 `93:7447`、S-39 `93:7592`、D-01 `83:3496`、D-02 `83:3628`、D-03 `83:3730`、D-04 `83:3826`、D-05 `83:3954`、D-06 `83:4036`、D-07 `83:4090`、S-40 `84:4480`、S-41 `84:4622`、S-42 `84:4725`、S-43 `84:4874`、S-44 `84:4941`、S-45 `84:5010`、S-46 `84:5078`、S-50 `85:5523`、S-51 `85:5760`、S-52 `85:5888`、S-53 `93:7717`、D-08 `85:6029`、S-60 `85:6086`、S-61 `85:6309`、S-62 `85:6474`、P-01 `85:6576`、S-70 `85:6709`、D-09 `85:6745`、D-10 `85:6801`、S-71 `85:6884`。

コンポーネント: Button `45:251`、Icon Button `45:301`、Badge `44:48`、Rarity `44:62`、Input `46:110`、Segmented `47:41`、Tabs `75:4453`、Progress `48:19`、Gauge `48:40`、Similarity `48:55`、Card `50:31`、Key Value `50:36`、Divider `50:41`、Nav Item `51:24`、Sidebar `51:348`、Top Bar `51:353`、Page Header `51:372`、Dialog `53:10`、Register `53:53`、Apply DNS `73:192`、Diff Row `73:188`、Form `76:312`、Danger `76:360`、Success `76:406`、Banner `69:60`、Skeleton `75:14`、Empty State `75:84`、Error Card `75:87`、Log Row `77:85`、Log Detail `77:90`、AI Log Entry `77:121`、AI Log Panel `77:124`、Search Result Row `78:398`、Transfer Item `78:475`、Domain Card `58:132`、Candidate Card `58:249`、Tree Node `54:33`、Tree Root `54:37`、Code Block `48:507`、Logo `43:6`、Sticker `43:9`、Goku `43:15`、Brand Bar `43:18`。

## 8. テスト方針

- `packages/shared`: `deriveDisplayStatus` の全分岐、`uniquenessLabel` / `rarityTier`。
- `apps/web`（vitest + jsdom）: `error-messages`（全コード）、`mock-services`（apply で状態が `applied` になる、`save` で `changed` になる、scenario `error` が `ApiClientError` を投げる）、`DangerDialog`（一致するまで disabled）、`SegmentedControl`（`aria-pressed` とキーボード）、`DomainCard`（displayStatus ごとのラベル）、`ApplyDnsDialog`（件数チップ）、`Banner` / `EmptyState` / `ErrorCard`（文言と action）。
- `pnpm check`（lint → typecheck → test）が全パッケージでグリーン。

## 9. 並列実行の切り方

1. **Foundation PR**（この worktree、1 本）: shared 追加 → web 基盤 → プリミティブ（2 名並列・ファイル分割）→ データ層 → AppShell。`pnpm check` → PR → main。
2. **Feature PRs**（main から各自 worktree、7 名並列）: auth+landing+system / dashboard / domains-new / domain-detail / subdomains / transfers / logs+settings。各自 `pnpm check` → PR。競合は `features/*` と `app/(app)/*` が分離されているためほぼ無い。
3. **統合 QA**: main で `pnpm dev` → 各 URL（§6）を確認 → 修正 PR。
