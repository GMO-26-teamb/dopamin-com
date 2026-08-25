# web UI 実装リファレンス（Figma・デザイントークン）

| 項目 | 内容 |
|---|---|
| 版 | v1（2026-08-26） |
| 対象 issue | #22（`DOCS-07`） |
| 目的 | Figma の参照情報・画面 ID ↔ ノード ID・デザイントークン対応表を 1 か所にまとめ、以降の web 画面実装 issue（#74〜）が毎回 Figma を探索せず実装できるようにする |
| Figma | **UI Design (Team B)** — https://www.figma.com/design/3gv0voomQ7jVtBzVUbnoZj/UI-Design--Team-B- （file key `3gv0voomQ7jVtBzVUbnoZj`） |
| 関連ドキュメント | [`docs/specs/ui-screens.md`](./ui-screens.md)（画面仕様 SSOT・状態・遷移・文言）/ [`docs/superpowers/specs/2026-08-26-fe-ui-design.md`](../superpowers/specs/2026-08-26-fe-ui-design.md)（データ層・コンポーネント設計）/ [`docs/ui-design/README.md`](../ui-design/README.md)（Figma ページ構成とスクリーンショット） |

## 1. Figma ファイル構成

| ページ | 内容 |
|---|---|
| Cover / Getting Started | Modernist 原則（角丸なし・2px 罫線・左揃え）、テーマ切替方法、トークン対応表 |
| Foundations / Color・Typography・Spacing & Layout・Icons | 変数 4 コレクション（Primitives / Color=Standard・極ドパ / Dimensions / Typography）、Text Style 25、Lucide アイコン 30 |
| Brand … Code Block（Components 15 ページ） | Badge / Button / Input / Segmented Control / Tabs / Progress & Gauge / Card / Navigation / Table / Logs / Dialog / Banner / Feedback / Tree / Code Block |
| Patterns / Domain Cards | Domain Card（Status 8 種）、Candidate Card（Rarity 5 種）、Search Result Row、Transfer Item |
| Examples / Screens | 代表画面 12 枚 × Standard / 極ドパ（スクリーンショットは §2.2） |
| **Prototype / Screens** | 全 60 画面・状態（`S-xx` / `D-xx` / `P-xx`）。ノード ID は §2.1 |
| Prototype / Screens (極ドパ) | 上記の極ドパモード版（同じフレーム名で再配線済み。ノード ID は Standard と異なるため本書では未収録 — 対象フレームを開いて都度確認する） |
| Prototype / Flow | 画面遷移マップ（`docs/ui-design/30-flow-map.png`） |

テーマは Color コレクションのモード（Standard / 極ドパ）だけで切り替わる。コンポーネントの差し替えはない。

## 2. 画面インベントリ

### 2.1 画面 ID → ルート → Figma ノード（Standard）

出典: `docs/specs/ui-screens.md` §2（ルート）/ `docs/superpowers/specs/2026-08-26-fe-ui-design.md` §7（ノード ID）。ダイアログ（`D-xx`）はモーダルなので URL は親画面のまま変わらない。

| ID | グループ | ルート | Figma ノード |
|---|---|---|---|
| S-00 | 認証 | `/` | `80:2` |
| S-01 / S-01b / S-01c | 認証 | `/signup` | `80:40` / `80:52` / `80:92` |
| S-02 / S-02b / S-02c | 認証 | `/login` | `80:168` / `80:179` / `93:7710` |
| S-03 | 認証 | `/login?reason=expired` | `80:209` |
| S-10 | ダッシュボード | `/dashboard` | `80:5548` |
| S-11 / S-12 / S-13 | ダッシュボード | `/dashboard` | `80:5563` / `80:5653` / `80:5713` |
| S-20 | ドメイン取得 | `/domains/new` | `81:741` |
| S-21 / S-22 / S-23 | ドメイン取得 | `/domains/new` | `81:921` / `81:1008` / `81:1034` |
| S-24 | ドメイン取得 | `/domains/new?q=` | `81:1156` |
| S-25 / S-26 / S-27 / S-28 | ドメイン取得（dialog） | `/domains/new` | `81:1437` / `81:1531` / `81:1588` / `81:1663` |
| S-30〜S-39 | ドメイン詳細 | `/domains/[name]` | `83:2444` `83:2497` `83:2709` `83:2959` `83:3179` `83:3348` `93:7153` `93:7322` `93:7447` `93:7592` |
| D-01〜D-07 | ドメイン詳細（dialog） | `/domains/[name]` | `83:3496` `83:3628` `83:3730` `83:3826` `83:3954` `83:4036` `83:4090` |
| S-40〜S-46 | サブドメイン設計 | `/domains/[name]/subdomains` | `84:4480` `84:4622` `84:4725` `84:4874` `84:4941` `84:5010` `84:5078` |
| S-40b | サブドメイン設計 | `/domains/[name]/subdomains` | —（フレームなし。§4 の読み込み規則で表現） |
| S-50〜S-53 | 移管 | `/transfers` | `85:5523` `85:5760` `85:5888` `93:7717` |
| D-08 | 移管（dialog） | `/transfers` | `85:6029` |
| S-60 / S-61 / S-62 | ログ | `/logs` | `85:6086` / `85:6309` / `85:6474` |
| S-63 | ログ | `/logs` | —（フレームなし。§4 の読み込み規則で表現） |
| P-01 | ログ（AI ログパネル） | 共通（右ドロワー） | `85:6576` |
| S-70 | 設定 | `/settings` | `85:6709` |
| S-70b | 設定 | `/settings` | —（フレームなし。S-71 と同型） |
| D-09 / D-10 | 設定（dialog） | `/settings` | `85:6745` / `85:6801` |
| S-71 | 設定 | `/settings` | `85:6884` |
| S-80 | システム | `*`（404 / 403） | `80:245` |
| S-81 | システム | error boundary（500） | `80:315` |

各画面の状態・使用コンポーネント・遷移・文言は `docs/specs/ui-screens.md` §2〜4 を参照する（本書では重複させない）。

### 2.2 コンポーネント → Figma ノード

`components/ui/*` は Figma のコンポーネント名と 1:1。全一覧は `docs/superpowers/specs/2026-08-26-fe-ui-design.md` §5（props / variants）・§7（ノード ID）にある。

### 2.3 スクリーンショット（`docs/ui-design/*.png`）

Examples / Screens 12 画面（Standard / 極ドパ）の抜粋。対応する画面 ID:

| PNG | 画面 ID |
|---|---|
| `10-landing-standard.png` / `11-landing-goku.png` | S-00 |
| `12-dashboard-standard.png` / `13-dashboard-goku.png` | S-10 |
| `14-domains-new.png` | S-20（候補表示は S-22） |
| `15-domain-detail.png` | S-30 |
| `16-subdomains-edit.png` | S-43 |
| `17-subdomains-apply-confirm.png` | S-44 |
| `18-subdomains-applied.png` | S-45 |
| `19-transfers.png` | S-50 |
| `20-logs.png` | S-60 |

デザインシステム自体の抜粋（`01-cover.png`〜`06-domain-card-statuses.png`）と遷移図（`30-flow-map.png`）は `docs/ui-design/README.md` を参照。

## 3. デザイントークン対応表

生成経路: `apps/web/lib/theme/tokens.json`（Figma 書き出し。手で編集する SSOT）→ `pnpm --filter @dopamin/web tokens`（`scripts/gen-tokens.ts`）→ `apps/web/app/tokens.css`（生成物・手で編集しない）→ `apps/web/app/globals.css` の `@theme inline` で Tailwind ユーティリティ名に写す。

### 3.1 色（Standard / 極ドパ）

Figma の code syntax（`var(--color-bg)` 等）は Dev Mode で確認できる。同じ CSS 変数を複数の Figma 変数が共有している場合はまとめて記載。

| Figma 変数 | CSS 変数 | Tailwind クラス | 標準 | 極ドパ |
|---|---|---|---|---|
| `color/bg/default`, `color/text/inverse` | `--color-bg` | `bg-bg` / `text-bg` | `#f3f2f2` | `#151318` |
| `color/bg/panel` | `--color-panel` | `bg-panel` | `#ffffff` | `#1d1b24` |
| `color/bg/track` | `--color-track` | `bg-track` | `#eceae6` | `#2c2a33` |
| `color/bg/inverse`, `color/text/default`, `color/border/strong` | `--color-ink` | `bg-ink` / `text-ink` / `border-ink` | `#201e1d` | `#eceaf2` |
| `color/bg/hover` | `--color-hover` | `bg-hover`（`hover:bg-hover`） | `#201e1d12` | `#eceaf214` |
| `color/bg/muted`, `color/text/muted`, `color/border/muted` | `--color-muted` | `bg-muted` / `text-muted` / `border-muted` | `#77726c` | `#9b97ab` |
| `color/bg/warn`, `color/text/warn`, `color/border/warn` | `--color-warn` | `bg-warn` / `text-warn` / `border-warn` | `#d6300f` | `#ff4d6d` |
| `color/bg/ok`, `color/text/ok`, `color/border/ok` | `--color-ok` | `bg-ok` / `text-ok` / `border-ok` | `#201e1d` | `#22d3ee` |
| `color/bg/code` | `--color-code-bg` | `bg-code-bg`（Code Block 背景） | `#0d0c10` | `#0d0c10` |
| `color/bg/overlay` | `--color-overlay` | `bg-overlay`（Dialog オーバーレイ） | `#201e1d80` | `#00000099` |
| `color/text/on-brand` | `--color-on-brand` | `text-on-brand`（Button primary 文字） | `#ffffff` | `#0d0c10` |
| `color/text/link` | `--color-link` | `text-link` | `#a21caf` | `#22d3ee` |
| `color/text/link-hover` | `--color-link-hover` | `text-link-hover`（`hover:text-link-hover`） | `#701a75` | `#22d3ee` |
| `color/text/code` | `--color-code-fg` | `text-code-fg`（Code Block 文字） | `#c8f5e4` | `#c8f5e4` |
| `color/border/default` | `--color-line` | `border-line` | `#201e1d` | `#3a3746` |
| `color/border/soft` | `--color-soft` | `border-soft` | `#dcd9d4` | `#2c2a33` |
| `color/brand/start` | `--color-brand-1` | `bg-brand-1` / `text-brand-1` / `border-brand-1` | `#7c3aed` | `#ff2fb3` |
| `color/brand/mid` | `--color-brand-mid` | `bg-brand-mid`（グラデーション中間色） | `#a83bb4` | `#8b5cf6` |
| `color/brand/end` | `--color-brand-2` | `bg-brand-2` / `text-brand-2` | `#db2777` | `#22d3ee` |
| `color/effect/glow-1` | `--glow-1` | 未登録（`--glow-brand` 経由のみ） | `transparent` | `#ff2fb359` |
| `color/effect/glow-2` | `--glow-2` | 未登録（`--glow-brand` 経由のみ） | `transparent` | `#22d3ee40` |

`--gradient-brand`（`linear-gradient(90deg, --color-brand-1, --color-brand-mid, --color-brand-2)`）と `--glow-brand`（`--glow-1` / `--glow-2` の box-shadow 合成）は `tokens.css` で組み立てる複合変数で `@theme` には登録しない。Button primary は `bg-[image:var(--gradient-brand)] shadow-[var(--glow-brand)]`、Goku ロゴのアニメーションは `.gradient-animated` クラスで使う（§4）。

### 3.2 サイズ・間隔

コンポーネントサイズのみ `globals.css` の `@theme inline` で `--spacing-*` に手動登録し、名前付き Tailwind ユーティリティになる。

| CSS 変数 | 値 | Tailwind クラス |
|---|---|---|
| `--size-sidebar` | `190px` | `w-sidebar` |
| `--size-page` | `1120px` | `max-w-page` |
| `--size-auth-card` | `440px` | `max-w-auth-card` |
| `--size-dialog` | `420px` | `w-dialog` |
| `--size-control-sm` | `28px` | `h-control-sm` |
| `--size-control-md` | `36px` | `h-control-md` |
| `--size-control-lg` | `44px` | `h-control-lg` |

その他の `dimensions`（`tokens.json`）は `:root` に px 固定値の CSS 変数として出力されるだけで、Tailwind の名前付きユーティリティには登録しない:

- `--space-2`〜`--space-48` は Tailwind 既定の 4px グリッド（`p-0.5`〜`p-12` 等）と同じ値になるため、既定のスペーシングユーティリティ（`gap-3` `px-4` `py-2` 等）をそのまま使う。
- `--size-icon-sm/md/lg`（14/16/20px）も Tailwind 既定スケール（`size-3.5` / `size-4` / `size-5`）と一致するため同様。
- `--size-bar-thin` / `--size-bar`、`--stroke-thin/medium/strong/accent` は該当する既定クラスが無い値のみ Tailwind の任意値で CSS 変数を直接参照する（例 `border-[length:var(--stroke-medium)]`、`border-l-[length:var(--stroke-accent)]`）。`--stroke-strong`（2px）は Tailwind 既定の `border-2` と一致するため素の `border-2` を使う。
- `--radius-none`（`0px`）は角丸を使わない、という宣言のためのトークンで、実装では `rounded-*` を一切付けない（`globals.css` のコメント参照）。
- `--opacity-disabled` / `--opacity-muted` は `opacity-[var(--opacity-disabled)]` のように任意値で参照する。

### 3.3 フォント

| CSS 変数 | Tailwind クラス | フォント |
|---|---|---|
| `--font-jp` | `font-jp` | Noto Sans JP（本文既定） |
| `--font-latin` | `font-latin` | Archivo（ドメイン名・スコア表示） |
| `--font-goku` | `font-goku` | Yuji Boku（極ドパのブランド表現のみ） |
| `--font-mono` | `font-mono` | JetBrains Mono（Code Block） |

next/font のインスタンス（`--font-noto-sans-jp` 等）は `app/layout.tsx` が注入し、`tokens.css` はそれを第一候補にフォールバックする（`var(--font-noto-sans-jp), "Noto Sans JP", sans-serif`）。

### 3.4 テキストスタイル（25、`tokens.json` の `textStyles` と 1:1）

`weight / size / line-height / tracking` は px（tracking は 0 以外のみ意味あり）。

| Figma スタイル | Tailwind クラス | font | weight / size / line-height / tracking |
|---|---|---|---|
| Display/Hero | `text-display-hero` | jp | 900 / 36 / 48 / -0.36 |
| Display/Score | `text-display-score` | latin | 800 / 26 / 28 / 0 |
| Display/Score Small | `text-display-score-sm` | latin | 800 / 16 / 18 / 0 |
| Heading/Page | `text-heading-page` | jp | 900 / 20 / 28 / 0 |
| Heading/Section | `text-heading-section` | jp | 700 / 18 / 24 / 0 |
| Heading/Card | `text-heading-card` | jp | 700 / 15 / 20 / 0 |
| Domain/Large | `text-domain-lg` | latin | 700 / 20 / 24 / 0 |
| Domain/Card | `text-domain-card` | latin | 700 / 15 / 20 / 0 |
| Domain/Small | `text-domain-sm` | latin | 700 / 13 / 16 / 0 |
| Brand/Logo | `text-brand-logo` | jp | 900 / 16 / 20 / 0 |
| Brand/Logo Latin | `text-brand-logo-latin` | latin | 900 / 16 / 20 / 0 |
| Brand/Goku | `text-brand-goku` | goku | 400 / 18 / 18 / 0 |
| Brand/Goku Small | `text-brand-goku-sm` | goku | 400 / 14 / 14 / 0 |
| Body/Lead | `text-body-lead` | jp | 400 / 14 / 26 / 0 |
| Body/Default | `text-body` | jp | 400 / 14 / 22 / 0 |
| Body/Small | `text-body-sm` | jp | 400 / 13 / 20 / 0 |
| Label/Default | `text-label` | jp | 700 / 13 / 16 / 0 |
| Label/Small | `text-label-sm` | jp | 700 / 12 / 16 / 0 |
| Label/Tiny | `text-label-xs` | jp | 700 / 11 / 14 / 0 |
| Caption/Default | `text-caption` | jp | 400 / 11 / 16 / 0 |
| Caption/Small | `text-caption-sm` | jp | 400 / 10 / 14 / 0 |
| Overline | `text-overline` | jp | 700 / 10 / 14 / 1.2 |
| Code/Default | `text-code` | mono | 400 / 11 / 19 / 0 |
| Code/Label | `text-code-label` | mono | 700 / 11 / 16 / 0 |
| Code/Input | `text-code-input` | mono | 400 / 13 / 20 / 0 |

## 4. テーマの扱い

- `<html data-theme="standard">` / `"goku"` が唯一の切替スイッチ。`tokens.css` は色だけを `:root[data-theme="standard"]` / `:root[data-theme="goku"]` に持ち、dimensions / opacity / font は `:root` 直下（テーマ非依存）。
- `apps/web/lib/theme/theme-provider.tsx` の `ThemeProvider` / `useTheme()` が状態を持つ。初期値は `app/layout.tsx` のインラインスクリプトが `localStorage`（キー `dopamin-theme`、`THEME_STORAGE_KEY`）から読んで `document.documentElement.dataset.theme` に先付けし、FOUC を防ぐ。既定は `"standard"`。OS の `prefers-color-scheme` は見ない（製品仕様として明示トグルのみ）。
- テーマ切替 UI は `components/app/theme-toggle.tsx`（Sidebar 下部）・`features/settings/theme-section.tsx`（S-70）。
- `.gradient-animated`（`background-image: var(--gradient-brand)`）は `:root[data-theme="goku"] .gradient-animated` かつ `@media (prefers-reduced-motion: no-preference)` のときだけ `gradient-pan` アニメーションが付く（Standard では静止したグラデーションのまま）。
- 角丸は常に 0（Modernist DS）。`:focus-visible` は `outline: 2px solid var(--color-brand-1)`。

## 5. モックモード（`?mock=`）

既定は `NEXT_PUBLIC_API_MODE=mock`。API なしで全画面・全状態をレビューでき、URL の `?mock=<scenario>`（`default` / `empty` / `loading` / `error` / `ai-timeout` / `partial-failure` / `stale` / `ns-fail` / `conflict` / `unsupported`）で状態を切り替える。シナリオ一覧・各シナリオが対応する画面 ID は [`README.md`「フロントエンド開発」](../../README.md#フロントエンド開発) と `apps/web/lib/api/mock/scenario.ts` を参照。画面ごとの具体的な確認 URL は `docs/superpowers/specs/2026-08-26-fe-ui-design.md` §6 にある。

## 6. 画面実装の手順

1. `docs/specs/ui-screens.md` §2 で対象 ID の状態・使用コンポーネント・遷移・文言を確認する。
2. 本書 §2.1 で Figma ノード ID を引き、Figma MCP の `get_design_context` に渡して該当フレームを取得する（`clientLanguages: "typescript"`, `clientFrameworks: "react"`）。既存コンポーネントは §2.2 のとおり `components/ui/*` と 1:1 なので、取得結果を新規実装ではなく既存コンポーネントの組み合わせにマッピングする。
3. 値を突き合わせるときは `get_variable_defs` で Figma 変数の実値を確定してから使う（本書の表を鵜呑みにせず、変更されていれば `lib/theme/tokens.json` 側を更新する）。
4. トークンを追加・変更した場合は `lib/theme/tokens.json` を手で編集し、`pnpm --filter @dopamin/web tokens` で `app/tokens.css` を再生成してコミットする（`tokens.css` を直接編集しない）。新しいテキストスタイルは `globals.css` に対応する `@utility text-*` も追記する。
5. 実装後は該当 URL に `?mock=` を付けて全状態を目視確認し、`pnpm check` を通す。

### Figma MCP の既知の落とし穴

- `opacity` の FLOAT 変数は **0–100 の百分率**で返る（0–1 ではない）。`tokens.json` / `tokens.css` の `--opacity-*` は小数（例 `0.45`）に変換して書く。
- `componentPropertyReferences` はインスタンスのサブレイヤーには設定できない。
- `resize()` は HUG（hug contents）指定をリセットする。サイズ変更後は auto layout の設定を確認・再設定する。
- ノード作成・変更直後の `get_screenshot` は古い（stale）ことがある。少し待つか撮り直す。
- `use_figma` の 1 回の呼び出しにつき `setCurrentPageAsync` は 1 回まで。
