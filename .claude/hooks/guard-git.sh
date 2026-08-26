#!/usr/bin/env bash
# PreToolUse(Bash): main への直接 push / force push / main 上での commit を block する。
# heredoc やコミットメッセージ中の文字列で誤検知しないよう、コマンド位置
# (行頭、または && ; | の直後) に現れる git 呼び出しだけを判定する。
set -euo pipefail
cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0
deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }
# コマンド位置の git 呼び出しを 1 行 1 件で抽出する
gitcalls=$(echo "$cmd" | grep -oE '(^|&&|;|\|\|?)[[:space:]]*git[[:space:]]+(push|commit)\b[^&;|]*' || true)
[ -z "$gitcalls" ] && exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
if echo "$gitcalls" | grep -Eq 'git[[:space:]]+push\b'; then
  echo "$gitcalls" | grep -Eq -- '(--force|[[:space:]]-f\b|--force-with-lease)' && deny "force push は禁止です。"
  echo "$gitcalls" | grep -Eq 'git[[:space:]]+push\b.*\bmain\b' && deny "main への直接 push は禁止です。ブランチを切って PR を作成してください(CLAUDE.md)。"
  [ "$branch" = "main" ] && deny "現在 main 上です。main への直接 push は禁止です(CLAUDE.md)。"
fi
if echo "$gitcalls" | grep -Eq 'git[[:space:]]+commit\b'; then
  [ "$branch" = "main" ] && deny "main 上での commit は禁止です。feat/<fr-id>-<slug> 等のブランチを切ってください(CLAUDE.md)。"
fi
exit 0
