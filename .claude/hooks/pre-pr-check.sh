#!/usr/bin/env bash
# PreToolUse(Bash "gh pr create"): pnpm check がグリーンでなければ PR 作成を block する。
set -uo pipefail
cmd=$(jq -r '.tool_input.command // empty')
echo "$cmd" | grep -Eq 'gh\s+pr\s+create\b' || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"
out=$(pnpm check 2>&1); rc=$?
if [ $rc -ne 0 ]; then
  tail=$(echo "$out" | tail -n 40)
  jq -n --arg r "pnpm check が失敗しています。修正してから PR を作成してください。
$tail" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
fi
exit 0
