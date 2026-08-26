#!/usr/bin/env bash
# Stop: 未コミットの差分があれば警告を表示する(worktree 自走時の成果消失防止)。
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
n=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -eq 0 ] && exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
jq -n --arg m "⚠ 未コミットの変更が ${n} 件あります (branch: ${branch})。コミットまたは PR 化を忘れずに。" '{systemMessage:$m}'
exit 0
