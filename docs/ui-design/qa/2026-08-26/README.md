# FE 統合 QA — 全画面スモークテスト（2026-08-26）

Phase P（PR #100〜#107）を `main` に squash マージしたあとの統合 QA 記録。

- ブランチ: `fix/fe-integration-qa`
- モード: モック（`NEXT_PUBLIC_API_MODE` 未設定 = mock）、`pnpm --filter @dopamin/web dev`（PORT=3110）
- ブラウザ: Chrome（Chrome DevTools MCP）、ビューポート 1280×900（撮影は DPR 2 → 1280px 幅に縮小して保存）
- テーマ: 断りがなければスタンダード。`data-theme="goku"` は「極ドパ」列に記載

## 結果サマリ

19 パターン中 **19 OK / 0 NG**。コンソールのエラー・警告・ハイドレーション不一致は **0 件**。
DevTools の Issue が 1 件（`/domains/*/subdomains` の「全体方針」入力に id / name が無い）出たので、この PR で修正済み（再確認 OK）。

## マトリクス

| # | ルート | スクリーンショット | 状態 | メモ |
|---|---|---|---|---|
| 1 | `/` | [root.png](./root.png) | OK | S-00 ランディング。ためしてみる（独自性スコア）まで描画 |
| 2 | `/login` | [login.png](./login.png) | OK | S-01。パスキーでログイン + 新規登録リンク |
| 3 | `/signup` | [signup.png](./signup.png) | OK | S-02 |
| 4 | `/dashboard` | [dashboard.png](./dashboard.png) | OK | S-10。4 件・「最終同期 3分前」が実時刻で出る（モック時計の修正後） |
| 5 | `/dashboard?mock=empty` | [dashboard-empty.png](./dashboard-empty.png) | OK | S-11 Empty State + CTA 2 つ |
| 6 | `/dashboard?mock=stale` | [dashboard-stale.png](./dashboard-stale.png) | OK | S-13 Banner Warn + 各カード Stale・更新系 Disabled |
| 7 | `/domains/new` | [domains-new.png](./domains-new.png) | OK | S-20。TLD 22 種のマルチセレクト。サイドバー Active =「ドメイン取得」 |
| 8 | `/domains/takutaku.com` | [domains-takutaku-com.png](./domains-takutaku-com.png) | OK | S-30 Active。残 330 日・2027-07-22 がダッシュボードと一致 |
| 9 | `/domains/tkt-lab.net` | [domains-tkt-lab-net.png](./domains-tkt-lab-net.png) | OK | S-32 移管申請受信。カウントダウンが `mm:ss` で毎秒進む |
| 10 | `/domains/demo-app.online` | [domains-demo-app-online.png](./domains-demo-app-online.png) | OK | S-33 RGP 残 18 日。更新 / 情報修正 / 廃止は理由つき Disabled、復旧のみ可 |
| 11 | `/domains/harupika.xyz` | [domains-harupika-xyz.png](./domains-harupika-xyz.png) | OK | S-39 コンタクト未移行。残 23 日・2026-09-18 がダッシュボードと一致 |
| 12 | `/domains/takutaku.com/subdomains` | [domains-takutaku-com-subdomains.png](./domains-takutaku-com-subdomains.png) | OK | S-40〜S-46。撮影時に出ていた Issue（入力の id / name 欠落）は修正済み |
| 13 | `/transfers` | [transfers.png](./transfers.png) | OK | S-50〜S-53。受信 1 / 申請中 1 / 履歴 1、カウントダウン `14:49` |
| 14 | `/logs` | [logs.png](./logs.png) | OK | S-60 操作ログ。もっと見る（残り 2 件） |
| 15 | `/logs?tab=ai` | [logs-ai.png](./logs-ai.png) | OK | S-61 AI ログ。タブが URL と同期 |
| 16 | `/settings` | [settings.png](./settings.png) | OK | S-70〜S-73。テーマ / パスキー / AI 設定 / デモリセット |
| 17 | `/no-such-page` | [not-found.png](./not-found.png) | OK | not-found。ダッシュボードへの導線あり |
| 18 | `/dashboard`（極ドパ） | [dashboard-goku.png](./dashboard-goku.png) | OK | `data-theme="goku"`。初回描画のちらつき・不一致なし |
| 19 | `/domains/new`（極ドパ） | [domains-new-goku.png](./domains-new-goku.png) | OK | 同上 |

## 統合の確認ポイント

- **残日数・日付の一致**: ダッシュボードと詳細で `残 n 日` と `YYYY-MM-DD` が一致（takutaku.com 残 330 日 / harupika.xyz 残 23 日 / demo-app.online 復旧猶予 残 18 日）。日付ヘルパーを `features/domains/format.ts` に統合した結果。
- **カウントダウン**: `/transfers` と `/domains/tkt-lab.net` のどちらも `mm:ss` で毎秒更新。`lib/use-countdown.ts` に統合し、サーバー描画では時刻を読まないのでハイドレーション不一致が出ない。
- **モックの基準時刻**: ブラウザでは読み込み時の実時刻（分丸め）を使うので、カウントダウンが期限切れで固まらず、「最終同期 3分前」も実時刻に追従する。テストは `NODE_ENV === "test"` で固定値のまま。
- **サイドバー Active**: `/domains/<name>` と `/domains/<name>/subdomains` は「ダッシュボード」、`/domains/new` だけ「ドメイン取得」。
- **状態バッジ**: 移管中 / 削除待ちがダッシュボードと詳細で同じ Tone（Muted）になった。

## 残っている気になり（この PR では直していない）

- サイドバー下部のテーマ切替（Segmented Control）が 190px 幅で 2 行に折り返す（「スタンダー / ド」）。読めはするが Figma より窮屈。ラベル短縮かサイズ調整はデザイン判断が要るので未着手。
- `?mock=stale` はすべてのドメインを stale にする。本来はレジストリ単位（Banner は Kitaqsign のみを名指ししている）。
- ダッシュボードのカード操作（今すぐ更新 / 復旧する / NS を設定）は詳細画面へ遷移する。仕様では D-01 / D-04 / D-02 をその場で開く。
