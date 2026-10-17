#!/usr/bin/env bash
# 小米减肥日记 —— Linux / macOS 启动脚本
#
#   bash start.sh                 # 默认 0.0.0.0:8087
#   PORT=9000 bash start.sh       # 换个端口
#   HOST=127.0.0.1 bash start.sh  # 只允许本机访问
set -euo pipefail
cd "$(dirname "$0")"

export PORT="${PORT:-8087}"
export HOST="${HOST:-0.0.0.0}"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [x] 没找到 node。"
  echo "      装一个 Node.js 20 或更新的版本再来。"
  echo "      如果是 CentOS 7 这类老系统，要装 glibc-217 的包，"
  echo "      见 README 的「老服务器（glibc < 2.28）」一节。"
  echo ""
  exit 1
fi

# 光有 node 不代表能跑：老系统的 glibc 太旧时，node 一启动就报
# GLIBCXX / GLIBC 版本找不到。先探一下，把原因说清楚，别只甩一串英文。
if ! node -e 'process.exit(0)' >/dev/null 2>&1; then
  echo ""
  echo "  [x] node 装是装了，但它自己启动不了："
  echo ""
  node -e 'process.exit(0)' 2>&1 | sed -n '1,6p' | sed 's/^/      /' || true
  echo ""
  echo "      最常见的原因：系统的 glibc 比 Node 要求的旧。"
  echo "      CentOS 7 是 glibc 2.17，而 Node 20+ 需要 2.28。"
  echo ""
  echo "      看看你的版本：  ldd --version | head -n 1"
  echo "      解决办法见 README 的「老服务器（glibc < 2.28）」一节。"
  echo ""
  exit 1
fi

echo ""
echo "  🍓 小米减肥日记"
echo "  正在启动…"
echo ""
echo "     监听：${HOST}:${PORT}"
echo "     本机：http://127.0.0.1:${PORT}"
echo ""

exec node server/index.mjs
