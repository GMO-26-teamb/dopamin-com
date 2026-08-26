# 文献レビュー(LITERATURE_REVIEW)

採用基準: 本文または公式概要を実際に確認できたもののみ。確認方法を各項に記載。
区分: [指定] = ユーザー指定文献 / [自主] = 独自調査で発見。

## 主要文献

### 1. [指定] Szurdi et al., "The Long 'Taile' of Typosquatting Domain Names"
- USENIX Security Symposium 2014, pp.191-206。著者: J. Szurdi, B. Kocso, G. Cseh, J. Spring, M. Felegyhazi, C. Kanich
- URL: https://www.usenix.org/conference/usenixsecurity14/technical-sessions/presentation/szurdi (公式概要を確認)
- 扱った問題: typosquattingの大規模実態(.comの約20%がtypoドメインと推定)。人気上位だけでなくロングテールも対象
- 本実装との関係: 編集距離ベースの変形が実際に大規模悪用されている実証 → 編集距離1カーブとred-team生成クラスの動機
- 採用: typoが主要脅威であるという前提。適用外: 収益化・登録動態の分析部分
- 反映: 生成器の変形クラス設計、編集距離1カーブ

### 2. [自主] Agten et al., "Seven Months' Worth of Mistakes: A Longitudinal Study of Typosquatting Abuse"
- NDSS 2015。著者: P. Agten, W. Joosen, F. Piessens, N. Nikiforakis
- URL: https://www.ndss-symposium.org/ndss2015/ndss-2015-programme/seven-months-worth-mistakes-longitudinal-study-typosquatting-abuse/ (公式概要を確認)
- 扱った問題: 人気500サイトの7ヶ月縦断観測。95%がtyposquatterに狙われ、防御的登録は少ない
- 本実装との関係: 「登録前に紛らわしさを警告する」という本機能の価値の実証的裏付け(防御が手薄な領域)
- 反映: missing-dot型(wwwgoogle)・TLD付加型(googlecom)の回帰テスト追加(2026-08-26実施)。注: これらの生成モデルはtyposquatting研究群で標準的に用いられるが、本論文該当節の本文は未確認のため厳密な初出帰属はしない

### 3. [指定] Kintis et al., "Hiding in Plain Sight: A Longitudinal Study of Combosquatting Abuse"
- ACM CCS 2017。arXiv:1708.08519 (arXiv概要を確認、会議はACM DL https://dl.acm.org/doi/10.1145/3133956.3134002 で確認)
- 扱った問題: 商標+付加語(betterfacebook, youtube-live)の468億DNSレコード規模の実証。悪用の60%が1000日以上存続
- 本実装との関係: 派生・包含カーブ(getnotion/superamazon/line-app)の直接の根拠。typoと独立のクラスとして扱う設計の裏付け
- 適用外: 悪用検知(DNS挙動)側の手法。本件は登録前の名前判定のみ
- 反映: 派生カーブ・包含カーブ・接辞リスト(具体点数は独自)

### 4. [指定] Nikiforakis et al., "Soundsquatting: Uncovering the Use of Homophones in Domain Squatting"
- ISC 2014 (Information Security Conference)。著者: N. Nikiforakis, M. Balduzzi, L. Desmet, F. Piessens, W. Joosen
- URL: https://www.securitee.org/files/soundsquatting_isc2014.pdf (本文PDFを確認)
- 扱った問題: homophone(同音異綴)によるスクワッティング。Alexa上位1万から8,476候補を自動生成、21.5%が既に登録済みで、調査ではパーキング広告・フィッシング等の悪用例も確認されている
- 本実装との関係: phoneticビューの根拠。**ただし論文は英語homophone辞書ベース。本実装の日本語ローマ字揺れ規則と重み0.90は独自**
- 反映: phoneticビューの存在意義。規則の中身は日本語向け独自設計

### 5. [指定] Unicode Technical Standard #39: Unicode Security Mechanisms
- Unicode Consortium (公式標準)。URL: https://www.unicode.org/reports/tr39/ (本文を確認)
- 内容: confusable検出(skeleton関数=視覚的正規形への写像)、mixed-script検査、識別子制限
- 本実装との関係: visualビュー(leet写像)は「視覚的正規形に写して比較する」というskeletonの考え方のASCII限定版
- **明記: UTS #39は完全実装していない。**Unicode confusables(キリル/ギリシャ文字等)・mixed-script検査は未実装。プロダクトがIDN非対応(FR-03)のため将来拡張として扱う
- 反映: visualビューの設計思想。将来のIDN対応時の実装指針

### 6. [指定] Le Pochat et al., "Tranco: A Research-Oriented Top Sites Ranking Hardened Against Manipulation"
- NDSS 2019。著者: V. Le Pochat, T. Van Goethem, S. Tajalizadehkhoob, M. Korczyński, W. Joosen
- URL: https://tranco-list.eu/assets/tranco-ndss19.pdf (本文PDFを確認)
- 扱った問題: Alexa等の既存ランキングは不安定(Alexaは日次で半分入替)かつ操作容易(1リクエストで100万位内)。複数リスト30日統合で操作耐性を確保
- 本実装との関係: 「人気サイトの比較対象コーパス」としてTrancoを選ぶ根拠(研究利用の標準・操作耐性・再現可能な引用)
- **明記: rank→popularity∈[0,1]の変換式(1-log10(rank)/4)とcurated固定値は独自設計**。Trancoは順位を提供するだけで変換式を規定しない
- 反映: コーパス選定。「知名度」でなく「Web人気度のproxy」という表現も本論文の位置づけに従う

### 7. [指定] Claessen & Hughes, "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs"
- ICFP 2000。URL(著者版ミラー): https://www.cis.upenn.edu/~bcpierce/courses/552-2008/resources/icfp-quickcheck.pdf (本文を確認。指定URLのtufts.eduはrobots制限で取得不可だったため同一論文の別ミラーを使用)
- 内容: 正しさを性質(property)として記述しランダム入力で検証する手法の原典
- 反映: propertyテスト群(スコア範囲・決定性・順序不変性・top1=決定根拠、fuzz 10万件)

### 8. [指定] Chen, Cheung & Yiu, "Metamorphic Testing: A New Approach for Generating Next Test Cases"
- arXiv:2002.12543 (原典は1998年HKUST技術報告のarXiv公開版。arXiv概要を確認)
- 内容: オラクル(正解)が得られない場合に、入力変換と出力の関係(metamorphic relation)で検証する手法
- 反映: 単調性テスト3種をmetamorphic relationとして定式化 — (a) popularity上昇でスコアが安全側へ動かない (b) 有名名への接近で不自然にスコアが上がらない (c) leet変形が安全側へ動かない

### 9. [指定] DeMillo, Lipton & Sayward, "Hints on Test Data Selection: Help for the Practicing Programmer"
- IEEE Computer, Vol.11, No.4, 1978, pp.34-41。DOI: 10.1109/C-M.1978.218136
- URL: https://dl.acm.org/doi/10.1109/C-M.1978.218136 (ACM DL) / https://ieeexplore.ieee.org/document/1646911/ (IEEE Xplore) で書誌確認
- 内容: mutation testingの原典。「意図的に欠陥を入れたプログラム(mutant)をテストが検出できるか」でテストスイートの質を測る
- 反映: 12種のmutant(min→max、popularity反転、各カーブ無効化、閾値入替等)で12/12 killを確認

## 補遺(要旨の直接確認が不完全なため設計根拠には使用しない)

- Gabrilovich & Gontmakher, "The Homograph Attack", Communications of the ACM 45(2), 2002。DOI: 10.1145/503124.503156。homograph攻撃の初出として著名(書誌はACM DLで確認、本文は取得制限により未確認)。UTS #39の背景文献として発表時の言及候補

## 実装要素との対応表

| 実装要素 | 根拠文献 | 採用した考え方 | 独自に決めた部分 | 根拠の強さ | 追加検証 |
|---|---|---|---|---|---|
| 編集距離1カーブ / DL距離 | Szurdi14, Agten15 | typoはDL距離1に集中 | 点数(20-55)、距離2の8文字ゲート | strong(クラス) / heuristic(点数) | holdout |
| 派生・包含カーブ | Kintis17 | combosquattingは独立クラス | 接辞リスト、点数、rem上限 | strong(クラス) / heuristic(点数) | holdout |
| phoneticビュー | Nikiforakis14 | 音類似は独立クラス | 日本語ローマ字規則・重み0.90 | partial(クラスは英語で実証、日本語規則は独自) | holdout+ローマ字ケース |
| visualビュー | UTS #39 | skeleton(視覚正規形)比較 | leetマップ・重み0.95。Unicode confusables未実装 | partial | IDN対応時 |
| Trancoコーパス+popularity | Le Pochat19 | 操作耐性ランキングを比較対象に | 変換式・curated値・α | strong(選定) / heuristic(変換式) | 実Tranco投入後再較正 |
| min合成・θ・floor | (設計判断) | — | 全て(安定領域から選択) | heuristic(感度分析済み) | holdout |
| 一般語免除 | (FA実測による独自) | — | 全て | heuristic(FA 4,025件で検証) | holdout+辞書拡充 |
| property/fuzz | QuickCheck00 | 性質のランダム検証 | 性質の中身 | strong(手法) | — |
| 単調性(metamorphic) | Chen98/20 | metamorphic relation | relationの中身 | strong(手法) | — |
| mutation 12種 | DeMillo78 | mutantによるテスト品質測定 | mutant選定 | strong(手法) | — |

## 発表での引用推奨(3〜5件)

1. **Kintis+ CCS 2017(combosquatting)** — 「getnotionを検出する根拠」として最も直接的。デモと直結
2. **Tranco NDSS 2019** — 「有名度の定義が恣意的でない」ことの一発回答。審査員質問対策の要
3. **Szurdi+ USENIX 2014 or Agten+ NDSS 2015** — typo対策の実証的必要性(「.comの約2割がtypoドメイン」は掴みに強い)
4. **UTS #39** — visualビューの背景+「未実装部分を将来拡張として認識している」誠実さの提示
5. **DeMillo+ 1978(mutation)** — 「テストの質まで検証した」という品質主張の裏付け
