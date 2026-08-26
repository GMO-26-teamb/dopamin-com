#!/usr/bin/env bash
# PreToolUse(Bash): main への直接 push / force push / main 上での commit を block する。
set -euo pipefail
cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0
deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }
if echo "$cmd" | grep -Eq 'git\s+push\b'; then
  echo "$cmd" | grep -Eq '(--force|-f\b|--force-with-lease)' && deny "force push は禁止です。"
  echo "$cmd" | grep -Eq 'git\s+push\b.*\b(origin\s+)?(main|HEAD:main)(\s|$|:)' && deny "main への直接 push は禁止です。ブランチを切って PR を作成してください(CLAUDE.md)。"
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  [ "$branch" = "main" ] && ! echo "$cmd" | grep -Eq 'git\s+push\b.*\s\S+:\S+' && ! echo "$cmd" | grep -Eq 'git\s+push\s+(-u\s+|--set-upstream\s+)?\S+\s+\S+' && deny "現在 main 上です。main への直接 push は禁止です。"
fi
if echo "$cmd" | grep -Eq 'git\s+commit\b'; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  [ "$branch" = "main" ] && deny "main 上での commit は禁止です。feat/<fr-id>-<slug> 等のブランチを切ってください(CLAUDE.md)。"
fi
exit 0
