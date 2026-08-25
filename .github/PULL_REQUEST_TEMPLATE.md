<!--
1 タスク = 1 spec = 1 PR。squash マージ時のタイトルは Conventional Commits に従うこと
（例: feat(api): ..., fix(web): ..., docs: ..., chore: ...）。
-->

## 概要

<!-- 何を・なぜ変更したか。対象 FR / NFR（例: FR-06）と参照した spec（例: docs/specs/registry-api.md）があれば書く -->

Closes #

## 変更

<!-- 変更したパッケージ・ファイル単位の箇条書き。挙動が変わる場合は Before/After が分かるように -->

-

## 検証

- [ ] `pnpm check`（Biome + typecheck + test）が green
- [ ] 受け入れ条件（AC-xx）を満たすことを確認した
- [ ] 影響範囲（他パッケージ・共有ファイル）を確認した

<!-- pnpm check が pre-existing な理由で red の場合はここに証拠（stash 比較など）を書き、"直さない" 判断を明記する -->

## `docs/requirements.md` への追随

- [ ] 要件・仕様（API 契約・データモデル・受け入れ条件・優先度）に変更なし
- [ ] 変更あり — `docs/requirements.md` を更新済み（版番号・更新履歴を含む。`spec-change-guard` / `spec-change-review` 対象）
