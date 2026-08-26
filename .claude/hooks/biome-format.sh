#!/usr/bin/env bash
# PostToolUse(Edit|Write): 編集ファイルを Biome で整形する(失敗しても止めない)。
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -z "$f" ] && exit 0
case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css) ;; *) exit 0;; esac
cd "${CLAUDE_PROJECT_DIR:-.}" && pnpm exec biome check --write "$f" >/dev/null 2>&1 || true
exit 0
