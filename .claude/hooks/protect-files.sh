#!/usr/bin/env bash
# PreToolUse(Edit|Write): 秘密情報・生成物への書き込みを block する。
# - .env* (.env.example を除く): CLAUDE.md「.env.local のコミット禁止」
# - pnpm-lock.yaml: pnpm install 経由でのみ変更する
# - packages/db/drizzle/**: `pnpm db:generate` の生成物
set -euo pipefail
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0
rel=${f#"${CLAUDE_PROJECT_DIR:-$PWD}/"}
base=$(basename "$rel")
deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }
case "$base" in
  .env.example) ;;
  .env|.env.*) deny "$rel は秘密情報ファイルです。編集はユーザーが手動で行ってください(CLAUDE.md 禁止事項)。" ;;
  pnpm-lock.yaml) deny "pnpm-lock.yaml は直接編集せず pnpm install / pnpm add で更新してください。" ;;
esac
case "$rel" in
  packages/db/drizzle/*) deny "$rel は pnpm db:generate の生成物です。直接編集せずスキーマを変更して再生成してください。" ;;
esac
exit 0
