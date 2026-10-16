#!/usr/bin/env bash
# 小米减肥日记 —— Linux / macOS 启动脚本
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] 没找到 node，先装一个 Node.js 20 或更新的版本吧"
  exit 1
fi

echo ""
echo "  🍓 小米减肥日记"
echo "  正在启动…"
echo ""
exec node server/index.mjs
