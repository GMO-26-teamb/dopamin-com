# 独自性スコア アルゴリズム仕様書(ALGORITHM_SPEC)

version: **v3.4-r2-ts.1** / 実装: `packages/shared/src/uniqueness/uniqueness.ts`(検証ハーネス: `uniq-lab/lib.mjs` と5,635件全数一致を確認済み)
本書は実装と1対1対応する。数式・定数を変更する場合は本書と `ALGORITHM_VERSION` を同時に更新すること。

## 0. 入出力

- 入力: 候補SLD文字列 `q`(RFC 1035検証はAPI層の責務。本関数は任意文字列を受けても例外を投げない)、前処理済みコーパス、オプション(パラメータ・一般語判定器)
- 出力: `{ score: 0..100整数, riskLevel: high|medium|low, confidence: normal|low, closestMatches: 上位3件, algorithmVersion, corpusVersion }`
- score 100 = 独自性最高(紛らわしくない)、0 = 最も紛らわしい
- 対象はASCIIドメインのみ。IDN/Unicode confusables(UTS #39完全版)は対象外(プロダクト仕様FR-03がIDN非対応のため)

## 1. 正規化ビュー(4+1種)

| ビュー | 定義 | 用途 |
|---|---|---|
| base | NFKC正規化 → 小文字化 → trim | 構造を壊さない基準形 |
| compact | base から `[-_.]` を除去(数字は除去しない) | ハイフン分断対策。短名判定・派生/包含判定の基準 |
| visual (L) | compact に leet写像L: 0→o, 1→l, 2→z, 3→e, 4→a, 5→s, 6→b, 7→t, 8→b, 9→g | 見た目類似 |
| visualI | 同上だが 1→i(「1」の二重解釈対応)。他はLと同じ | 見た目類似(iバリアント) |
| phonetic | compact に以下の17規則を**この順で逐次適用**: shi→si, chi→ti, tsu→tu, fu→hu, ji→zi, ph→f, ck→k, q→k, c(母音aouの前)→k, c(eiの前)→s, l→r, x→ks, ou→o, oo→o, uu→u, ee→e, aa→a。その後、結果が4文字以上なら連続同一文字を1文字に圧縮 | 日本語ローマ字の読み揺れ |

コーパス側は投入時に同じ5ビュー+文字ヒストグラム(a-z0-9の36要素、visualIビュー上)を事前計算する。

## 2. 有名度 popularity ∈ [0,1]

- tranco層: `pop = max(0, 1 − log10(max(1, rank)) / 4)`(rank1=1.0, 10=0.75, 100=0.5, 1000=0.25, 10000=0)
- curated-jp層: 固定 **0.90** / curated-tech層: 固定 **0.85**(ターゲット層内認知の仮定値。Tranco順位とは意味の異なるproxy)

## 3. 文字列類似度

- `jaro(a,b)`: 標準Jaro(マッチ窓 = ⌊max(|a|,|b|)/2⌋−1、転置は半数カウント)
- `jaroWinkler(a,b) = jaro + p·0.1·(1−jaro)`、pは共通接頭辞長(最大4)
- `dlDist(a,b)`: Damerau-Levenshtein(OSA: 挿入・削除・置換・隣接転置が各距離1)
- `ndl(a,b) = 1 − dlDist/max(|a|,|b|)`(両方空なら1)
- `pairSim(a,b) = max(jaroWinkler, ndl)`

## 4. 候補側の前処理

- `shortMode = (compactの長さ ≤ 3)`。shortModeでは compact/visual/phonetic ビュー比較とルール系カーブ(派生・包含・編集距離)をすべて無効化し、baseビューのみで判定。`confidence = "low"`
- `isWord = 一般語判定`: 同梱英語リスト(hunspell en_US.dic由来75,150語、`^[a-z]{3,15}$`)∪ 日本語ローマ字補完リスト ∪ 補完3語(denote等)に、次のステミングを併用 — 語尾 es/s/ing(+e)/ed(+e,+1字)/er(+1字)/ly を剥がした基底形(3文字以上)も照合

## 5. エントリごとの重み付き類似度

```
sims.base     = pairSim(cand.base, e.base)
sims.compact  = pairSim(cand.compact, e.compact)                        (shortModeでは0)
sims.visual   = max(pairSim(cand.visualL, e.visualL), pairSim(cand.visualI, e.visualI)) (同)
sims.phonetic = pairSim(cand.phonetic, e.phonetic)                      (同)
weighted = max(base, compact×0.97, visual×0.95, phonetic×0.90)
```

## 6. 5本のカーブ(エントリごとに計算、各値は0..100、小さいほど危険)

| カーブ | 適用条件 | 式(定数は§9) |
|---|---|---|
| popularity | 常時 | `100·clamp01((0.92 − weighted·(0.5 + 0.5·pop)) / (0.92 − 0.72))` |
| floor | 常時 | `100·clamp01((0.98 − weighted) / (0.98 − 0.85))` |
| derived | shortMode以外、コーパス名(compact)3文字以上、かつ compact/visualL/visualI いずれかのビューで「候補 == 接辞+名前」or「名前+接辞」(接辞リスト34語: get my try use app hq lab labs dev the go pro plus web online site official jp tokyo super mega ultra neo mini smart easy best top new kun chan san sama ai)、または「名前+数字1〜4桁」「数字1〜4桁+名前」 | `55 − 35·pop` |
| contain | shortMode以外、コーパス名(compact)5文字以上。(a)完全包含: いずれかのビューで候補が名前を部分文字列として含み、残り文字数 rem ∈ [1,10] (b)近似包含: (a)不成立時、共通文字数 ≥ 名前長−1 のとき、名前と同じ長さの窓を候補上でスライドさせ窓とのDL距離 ≤ 1 が存在 | (a) `75 − 45·pop + 5·max(0, rem−4)` (b) 同式 `+10`(typoペナルティ) |
| edit | shortMode以外、候補base4文字以上。`dist = min(DL(base同士), DL(visualL同士), DL(visualI同士))` | dist≤1: `20 + 35·(1−pop)` / dist=2 かつ max(候補長,名前長)≥8: `45 + 30·(1−pop)`(ラベルedit2) |

## 7. 合成と一般語免除

```
if (isWord かつ weighted < 0.95):        # 一般語免除
    si = min(100, min(popularity, floor) + 15)      # ルール系3カーブは不適用
    curve = "popularity+word" または "floor+word"
else:
    si = min(popularity, floor, derived, contain, edit)
    curve = 最小値を与えたカーブ名(edit はdist値により edit1/edit2)
```

- 免除の除外条件 weighted ≥ 0.95 により、コーパス名と極端に近い候補(完全一致・amazons級)は実在語でも免除されない
- **完全一致に特別ルールはない**: weighted=1.0 となり floor が 0 を返すため自然に最低帯へ落ちる(propertyテストでコーパス全名 < 40 を保証)

## 8. 最終出力

- 全エントリを `si` 昇順でソート。**同点規則**: ECMAScript仕様(ES2019以降)により `Array.prototype.sort` は安定 — 同点時はコーパス配列の元順序を保持
- `score = round(clamp(先頭エントリのsi, 0, 100))`(整数)。closestMatches = 上位3件。各件が持つのは `name`(コーパス上の名前)/ `score`(そのエントリ単体のsi。丸め前)/ `similarity`(§5の`weighted`。重み付き類似度であってビュー別の生類似度ではない)/ `curve`(決定カーブ名: popularity / floor / derived / contain / edit1 / edit2 / popularity+word / floor+word)/ `popularity`(エントリのpop)の5項目。ビュー別の生類似度(§5の`sims`)は内部計算のみで公開しない(§10のプレフィルタでスキップしたエントリでは未計算のため全件分は存在しない)。**先頭 = スコアを決定した相手**であることをpropertyテストで保証
- `band: score≥70 high / 40..69 mid / <40 low`。`riskLevel` はその逆向き(high band → risk low)
- コーパスが空: score 100, closestMatches [], confidence は短名規則どおり

## 9. 定数一覧(すべて較正による独自値。論文由来ではない)

| 定数 | 値 | 決め方 |
|---|---|---|
| wc / wv / wp | 0.97 / 0.95 / 0.90 | 「加工が強いビューほど弱い証拠」の序列。ヒューリスティック |
| alpha | 0.5 | グリッド安定領域(0.4〜0.6)の中心 |
| thH / thL | 0.92 / 0.72 | グリッド安定領域(0.90-0.94 × 0.70-0.74)の中心 |
| fH / fL | 0.98 / 0.85 | 初期値(JWノイズ床の実測に基づく)。安定性は感度確認済み、独立最適化はしていない |
| dBase / dSlope | 55 / 35 | 人間確定ラベル(getzorufa=high, getnotion=low等)からの逆算 |
| cBase / cSlope / cRelief / cRemMax / cTypoPenalty | 75 / 45 / 5 / 10 / 10 | red-teamラウンド2の反例(underwikipedia, spotifywordpress, getgoogel)への対処で決定 |
| eBase / eSlope | 20 / 35 | kiktok反例への対処で決定 |
| e2Base / e2Slope | 45 / 30 | ealesfoce反例と taviko=high ラベルの両立で決定(8文字ゲート含む) |
| wordRelief / wordReliefMaxSim | 15 / 0.95 | FA攻撃セット4,025件での測定により決定 |
| popJp / popTech | 0.90 / 0.85 | 仮定値(較正対象として明示) |
| band境界 | 70 / 40 | 要件定義書§14.2のラベル区分に準拠 |

## 10. 性能プレフィルタ(結果不変)

コーパスエントリごとに、文字ヒストグラム共通数 `c` から上界
`pairBound = max(0.6·((c/|cand| + c/|e| + 1)/3) + 0.4, c/maxLen) + 0.05` を計算し、
`pairBound < thL` かつ ルール発火可能性なし(`lenDiff ∈ [−2, 10]` かつ `c ≥ |e|−2` が不成立)のエントリは本計算を省略(si=100扱い)。
**等価性検証済み**(5,417件+5,635件で差異0)。なお「compactビュー2段階足切り」(旧プレフィルタ2)は非等価が実証されたため実装から**除外**(検証ハーネスにのみフラグ付きで残置)。

また、一般語判定のデフォルト辞書(同梱75,150語のSet)は**モジュール単位で1回だけ構築**され、以後の全採点で再利用される(`getDefaultWordChecker`。結果不変の性能仕様。採点ごとの再構築はしない)。

## 11. 既知の限界(要旨)

短名(≤3文字)は判定精度が構造的に低い(confidence: lowで明示)/ 接辞リスト外+4文字有名名は素通りし得る / 一般語辞書の網羅性に依存(固有名詞混入は0.95ガードで緩和)/ min合成は複数の中程度リスクを加算しない / 0.95・8文字等の境界に不連続がある / 較正値は擬似コーパス129件時点のもので、実コーパス基準の再較正は未実施(実Tranco 8,520件 + curated 58件 = 統合8,543件は投入済み。既定コーパス識別子 `tranco-74V4X-2026-08-26-top10k+curated-v1`。移行時の挙動変化と未適用の対応候補は AUDIT_TRANCO.md を参照) — 詳細はDESIGN_RATIONALE.mdと数理監査レポート(検証ワークスペース側。リポジトリには含まれない)を参照。
