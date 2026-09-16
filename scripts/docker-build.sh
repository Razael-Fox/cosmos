#!/bin/sh
# Builds the single-container image using Git worktrees for multi-branch sources.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if git rev-parse --verify website >/dev/null 2>&1; then
  git worktree add --detach .worktrees/website website 2>/dev/null || git worktree repair .worktrees/website 2>/dev/null || true
fi
if git rev-parse --verify api >/dev/null 2>&1; then
  git worktree add --detach .worktrees/api api 2>/dev/null || git worktree repair .worktrees/api 2>/dev/null || true
fi

docker build -f docker/Dockerfile -t cosmos-all-in-one:latest .
