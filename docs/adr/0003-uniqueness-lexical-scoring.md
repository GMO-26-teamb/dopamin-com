# ADR-0003: 独自性スコアは embedding ではなく lexical 方式で実装する

- 日付: 2026-08-26
- 状態: 採用
- 関連: `docs/requirements.md` §10.4 / §13.3 / §14、FR-05、
  `docs/specs/uniqueness/ALGORITHM_SPEC.md` / `DESIGN_RATIONALE.md` / `AUDIT_TRANCO.md`

## 背景

要件 §14 は独自性スコアの算出方式を「埋め込みモデルによる類似検索」（embedding + pgvector）と
規定し、§11 に `reference_names`（vector 列）と `uniqueness_checks`（キャッシュ）テーブル、
§10.2 に `POST /ai/uniqueness`、環境変数に `UNIQUENESS_THETA_LOW/HIGH`（cosine 閾値の較正値）を
用意していた。一方 §14.3 は「短い文字列に対する埋め込みの弁別力が不足する場合、編集距離 /
Jaro-Winkler をガードとして併用する。この判断は較正結果を見て ADR に記録する」と、
lexical 方式への転換余地を明示していた。本 ADR がその記録である。

## 決定

1. **算出方式は lexical（文字列ベース）のみとする。embedding は使わない。**
   実装は `packages/shared/src/uniqueness/`（v3.4-r2-ts.1）: 4+1 正規化ビュー
   （typo / leet / 日本語ローマ字読み）× Damerau-Levenshtein / Jaro-Winkler ×
   5 カーブ min 合成 + 一般語免除。全数式は ALGORITHM_SPEC.md。
2. **比較コーパスは DB でなくビルド同梱の静的モジュールとする。**
   Tranco（リスト ID `74V4X`、2026-08-26 取得、上位 1 万行から SLD 抽出。アダルト・海賊版の除外後 8,520 件）+
   curated-jp/tech 58 件。生成は `packages/shared/scripts/convert-tranco.mjs`（オフライン、
   出典・checksum をコード内 `TRANCO_META` に記録）。API は tsup バンドルに同梱されるため
   本番で確実に読み込め、DB 接続・seed 運用・コールドスタート増を持ち込まない
   （ロード実測: parse+前処理 計約 150ms、プロセスで 1 回のみ）。
3. **したがって §11 の `reference_names` / `uniqueness_checks` テーブル、pgvector、
   §13.3 の埋め込みパイプライン、`POST /ai/uniqueness` は実装しない。**
   スコアは `POST /domains/check` の `uniqueness` フィールド（§10.4）として返す。
   1 件あたり実測 p95 約 0.22 秒（AC-05-3 の上限 1.5 秒を大きく下回る）のため
   キャッシュテーブルも不要。
4. **`UNIQUENESS_THETA_LOW/HIGH` 環境変数は使用しない。**
   較正済み定数はアルゴリズム内部（`DEFAULT_PARAMS`）にあり、ラベル境界は §14.2 の
   40 / 70 を `uniquenessLabel` が固定で持つ。env 変数は後続の掃除で削除候補。

## 根拠

- **チーム合意**: 判定基準は「表記の類似・読みの類似・相手の有名度」とし、意味の類似
  （例: `bookstore` と `library`）はスコアに含めない方針を Day2 に合意した。意味類似を
  含めない以上、embedding の主目的が消える。
- **§14.3 が予見した弁別力問題**: `gogle`→`google` のような 1 文字 typo・leet・ローマ字
  揺れは、まさに embedding が弱く lexical が強い領域で、FR-05 の主目的（紛らわしさの警告）
  はこのクラスの検出にある。
- **検証可能性**: lexical 方式は決定的で、JS 検証ハーネスとの 5,635 件全数一致・
  property/metamorphic/mutation テスト・約 19 万件の red-team を通した
  （DESIGN_RATIONALE.md）。embedding では同水準の再現性・監査可能性を 5 日で確保できない。
- **運用**: 埋め込み API 依存（レート・課金・鍵管理）と pgvector 運用が消える。

## 影響・残課題

- 実 Tranco コーパスでの傾向監査は AUDIT_TRANCO.md に記録（gold 開発セットは 90 件中 84 件
  一致。差分 6 件はいずれも実在の近傍名の出現による説明可能な mid 化で、ラベルの改変はしない）。
- 要件への反映は **`docs/requirements.md` v0.1.14（2026-08-26、PR #155）で完了**。
  §14 を lexical 方式に差し替え、§9.1 の `reference_names` / `uniqueness_checks`、
  §10.1 の `POST /ai/uniqueness`、§13.3 の埋め込み、§6.1 図・§7 の pgvector、
  §17 の `EMBEDDING_*` / `UNIQUENESS_THETA_*` を「不採用（ADR-0003）」とした。
  §14.3 の【要確認】と §21.2 #9 も解決済み。
  §16.3 の Supabase `vector` 拡張が不要になった点だけ反映が漏れていたので v0.1.18 で追記した。
- 参照コーパスにはアダルト・海賊版サイトを含めない（`topSimilar` の名前が画面に
  そのまま描画されるため）。除外規則は `packages/shared/scripts/corpus-denylist.mjs`
  が持ち、生成時に適用する。
- 将来 embedding を併用する場合も、§14.3 の `score = min(score_embedding, score_lexical)`
  の形で本実装の上に足せる（本実装の置き換えは不要）。
