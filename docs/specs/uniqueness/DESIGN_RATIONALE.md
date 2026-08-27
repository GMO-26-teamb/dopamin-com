# 独自性スコア 設計根拠(DESIGN RATIONALE)

対象: v3.4-r2-ts.1(実装: packages/shared/src/uniqueness/。検証ハーネス: uniq-lab/lib.mjs)。
本書は「どの要素が先行研究に根拠を持ち、どの数値が今回独自の較正か」を明確に区別する。

## 原則

**先行研究が根拠づけるのは「攻撃パターンの存在と分類」「比較対象・検証手法の選択」であり、
本実装の具体的な重み・閾値・点数は、先行研究由来ではなく今回のデータ(人間確定ゴールドセット+安定領域探索)による独自較正である。**

## 対応表

| 実装要素 | 解決する混同パターン | 参考研究・規格 | 論文から採用した考え方 | 今回独自に決めた部分 | 検証方法 | 既知の限界 |
|---|---|---|---|---|---|---|
| 編集距離1カーブ(eBase=20+35(1-pop)) + Damerau-Levenshtein | typosquatting(挿入/削除/置換/隣接転置/重複打鍵) | Szurdi+ USENIX Sec 2014、Agten+ NDSS 2015 | typoの主要クラスがDL距離1に集中するという知見。red-team生成の変形クラス(全削除・全転置・置換・挿入・重複・missing-dot型)もこの分類に対応。missing-dot型・TLD付加型はtyposquatting研究群で標準的とされる生成モデルだが、両論文の該当節の本文は未確認(公式概要のみ確認)のため、帰属は「研究群で標準的」に留める | 距離1→20〜55点という具体点数、pop傾斜。**距離2は8文字以上限定という割り切り(論文にない独自判断**: 短い名前の距離2は別語が多い、taviko/radiko人間ラベルと整合させた) | 系統攻撃9,823件 + gold(gogle/goolge/kiktok等) + mutation M06 | 距離2×7文字以下(airwb等)はfloor/popularity任せ |
| 派生カーブ+包含カーブ(接辞リスト、包含rem1-10、近似包含) | combosquatting(商標+付加語: getnotion, superamazon, line-app, wwwgoogle) | Kintis+ ACM CCS 2017 | 「有名名+別文字列の連結」が独立した主要な攻撃クラスであり、typoと別に扱うべきという分類 | 接辞リストの中身(get/my/…+日本語敬称kun/chan/san等)、点数式(derived 20-55 / contain 30-75+relief5/文字)、rem上限10 | 創造的red-team 32,364件、gold派生群、mutation M05/M11 | 接辞リスト外+4文字有名名(kokoline型)は素通り(既知の限界として文書化) |
| phoneticビュー(w_p=0.90) | soundsquatting(読み・音の類似: racuten, tutaya) | Nikiforakis+ ISC 2014 | 「発音が同じ/近い綴り違い」が独立した攻撃クラスであるという知見 | **論文は英語homophone対象。日本語ローマ字揺れ規則(si/shi, ti/chi, tu/tsu, l/r, c/k等17規則)と重み0.90は完全に独自実装** | goldローマ字群、FA攻撃(romaji語)、mutation M04 | 規則ベースのため網羅性は規則の数に依存。かな読みは対象外 |
| visualビュー(leet 0-9マップ、1のl/i両解釈) | 視覚的混同(g00gle, l1ne) | UTS #39 (Unicode Security Mechanisms) | 「視覚的に混同しうる文字を正規形(skeleton)に写像して比較する」という考え方 | **UTS #39は完全実装していない**(ASCII leetのみ。キリル文字等Unicode confusablesとmixed-script検査は未実装=将来拡張)。leetマップの中身と重み0.95は独自 | goldのleet群、創造的red-team(全角はNFKCで正規化されることを確認)、mutation M03 | 多文字homoglyph(rn→m)未対応。IDNはプロダクト仕様(FR-03)自体が対象外 |
| 比較コーパス(Tranco上位+curated)とpopularity補正 | 「有名な名前との」混同に限定する設計 | Le Pochat+ NDSS 2019 (Tranco) | 研究用途に耐える操作耐性のある人気ランキングを比較対象に使うこと。「人気度のproxy」という位置づけ | **rank→popの変換式 1-log10(rank)/4、curated固定値(jp0.90/tech0.85)、乗算補正α=0.5はすべて独自設計** | 擬似コーパス129件で機構検証したのち、実Trancoコーパス(listId 74V4X / 2026-08-26取得、top10k由来8,520件)+curated 58件=統合後8,543件(重複35件はpopularityの高い方を採用)へ移行済み。これが `getDefaultPreparedCorpus()` の既定=本番経路(`apps/api/src/services/check.service.ts`)。移行時の挙動差はAUDIT_TRANCO.mdに記録 | 実コーパス基準での再較正(重み・閾値の見直し)もgoldラベルの付け直しも未実施(AUDIT_TRANCO §2)=閾値は擬似コーパス時代のまま。移行でgold開発セットは90/90→84/90(AUDIT_TRANCO §1)。curatedとTrancoのpopularityは意味が異なるproxyの混在 |
| min合成+2本の連続カーブ(popularity/floor) | ワーストケース原理(最も紛らわしい1件が危険を決める) | (直接の出典なし=設計判断) | — | **カーブ形状・θ(0.72/0.92)・floor端点(0.85/0.98)・α=0.5は較正による独自値**。θとαはグリッドの安定領域(0.70-0.74×0.90-0.94×0.4-0.6)から選択 | 感度分析(±10%相当の安定領域確認)、property 10万件 | 複数の中程度リスクを加算しない(意図した割り切り) |
| 一般語免除(hunspell辞書+ステミング, relief+15, 上限sim0.95) | False Positive抑制(life/room/notebook等の実在語) | (FA測定に基づく独自機構。Agten+の防御的登録の議論が背景) | — | 全部独自(辞書選択・relief値・0.95閾値) | FA攻撃セット4,025件上でlow 0.87%(このセット上の値であり一般のFA率ではない)、mutation M12 | 辞書の網羅性、固有名詞混入、0.95付近の不連続(監査で指摘済み) |
| property/fuzzテスト(10万件、範囲・決定性・順序不変) | テスト手法 | Claessen & Hughes ICFP 2000 (QuickCheck) | 「正しさを性質として書き、ランダム入力で検証する」手法 | 検証する性質の中身は本アルゴリズム固有 | prop2.mjs実行(ハード違反0) | — |
| 単調性テスト(pop↑でスコア↑しない等) | オラクルなしの検証 | Chen, Cheung & Yiu (metamorphic testing, arXiv:2002.12543) | 「入力の変換に対する出力の関係(metamorphic relation)」で正解ラベルなしに検証する手法 | 3つのrelation(popularity単調性/接近時の非上昇/leet変形の安全側)の定式化は本件固有 | prop2.mjs P7-P9(違反0。パス逆転21件は多エントリ近接で説明済み) | ランダムウォークは真の距離単調でないため弱い検定 |
| mutation testing 12種 | テスト自体の検出力検証 | DeMillo, Lipton & Sayward, IEEE Computer 1978 | 「意図的な欠陥(mutant)をテストが検出できるかでテストの質を測る」手法 | mutantの選定(min→max、pop反転、各カーブ無効化等)は本件固有 | mutate.mjs: 12/12 kill | mutantは手選定(自動生成ではない) |
| ゴールド/holdout分離、blindレビュー | 過学習の検出体制 | (機械学習の標準慣行。特定論文には帰属させない) | 較正データと評価データの分離、ラベル確定前にスコアを見せないblind protocol | 分割の系列単位ホールドアウト設計 | batch2(118件)未開封で封印中 | 開発セット100%は較正セット上の数字であり最終精度ではない |

## 特に明確にする区別

**先行研究を根拠にできる主張**: 「typo/combo/sound/visualの4攻撃クラスをカバーする設計にした」「比較対象に操作耐性のある人気ランキング(Tranco)を選んだ」「property/metamorphic/mutationの3種のテスト手法を適用した」。

**先行研究を根拠にできない(=今回の較正・判断による)主張**: w_c=0.97/w_v=0.95/w_p=0.90、α=0.5、θ=0.72/0.92、floor 0.85/0.98、各カーブの点数(20/45/55/75等)、relief+15、0.95免除上限、low/mid/highの40/70境界、popularity変換式、短名≤3文字ポリシー、距離2の8文字ゲート。これらは「人間確定ラベル+安定領域探索で較正した値」であり、論文由来と主張してはならない。

## 検証記録(2026-08-26)

統合形態: 最新 `origin/main` から作成した専用ブランチ `feat/fr-05-uniqueness-score` 上で、既存の `packages/shared/src/uniqueness.ts`(ラベル・レアリティAPI)を維持したまま `export * from "./uniqueness/index"` でFR-05実装をパッケージ公開入口(`@dopamin/shared`)へ接続。同梱英語辞書は `scripts/generate-common-words.mjs` で再生成可能(出典・ライセンスは `commonWordsEn.ts` 冒頭に記載)。

| 項目 | コマンド/方法 | 結果 |
|---|---|---|
| lint/format | `biome check`(v2.5.10、リポジトリのbiome.json) | エラー0 |
| 型チェック | `tsc --noEmit`(TypeScript 6.0.3、リポジトリのtsconfig = strict + noUncheckedIndexedAccess 等) | エラー0 |
| 単体テスト | `bun test`(vitest互換ランナー。コンテナ環境はnpm registry遮断のため) | パッケージ全体 420 pass / 0 fail(独自性スコア分は回帰120件+公開入口経由4件) |
| 公開入口import | `@dopamin/shared` からの self-reference import をテストで検証(public-api.test.ts) | 解決・実行とも成功 |
| JS↔TS全数一致 | parityスクリプト(gold91+ランダム5,000+攻撃系544=5,635件)。noUncheckedIndexedAccess対応リファクタ後に再実行 | 差異0 |
| 連続採点性能 | 129件コーパス+同梱75,150語辞書で1,000件連続採点 | 初回40.8ms(辞書Set構築込み)、以後 平均1.5ms/件・p50 1.4ms・p95 2.8ms(約650件/秒)。修正前は採点ごとに辞書Setを再生成し約14.6ms/件 → 約9.5倍改善 |
| rebase / push | Mac上で `git fetch` → `git rebase origin/main`(ab36924) → `git push -u origin feat/fr-05-uniqueness-score` | 完了(rebase後コミット cc43826。rebase前は c210461) |
| 実リポジトリ 実vitest(@dopamin/shared) | Mac上 `pnpm check`(turbo経由・vitest 4.1.11)初回実行 2026-08-26 16:05 | 447 pass / 1 fail。唯一の失敗は property fuzz テストが **vitest既定timeout 5秒を超過**したもの(実測約22秒。スコア実装の不具合ではない)。本修正コミットで重いテスト3件に timeout を明示指定 |
| api / web のテスト | 同実行内で未完走・失敗 | 新worktreeに gitignore 対象の `.env.local`(リポジトリ直下・apps/api)が未配置だったことが原因と推定(未完走はDB接続系のみ)。配置のうえ再実行 |
| 再実行 `pnpm check`(全green) | 2026-08-26 16:47、コーパス統合ブランチ上(コア+統合の両変更を含む)でMac実行 | **9タスク全て成功**(実vitest: web 494/494・registry 80/80 ほか、typecheck・lint含む) |
| push | 両ブランチ完了 | `feat/fr-05-uniqueness-score` = c56e74a / `feat/fr-05-corpus-integration` = 5c0a0a6 |
| PR作成・マージ | PR #155(コミット 6924915、2026-08-26 18:17 JST)でコーパス統合込みでmainへマージ | 完了。実Tranco投入(`packages/shared/src/uniqueness/corpusTranco.ts`)・ADR-0003(`docs/adr/0003-uniqueness-lexical-scoring.md`)・AUDIT_TRANCO(`docs/specs/uniqueness/AUDIT_TRANCO.md`)・API/Web接続(`apps/api/src/routes/domains.ts` / `apps/web/lib/api/http/http-services.ts`)を内包 |

※ 上記をもって「FR-05本番統合完了」。SSOT側は `docs/requirements.md` v0.1.14 で追随済み。
