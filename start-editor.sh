#!/usr/bin/env bash
# 实验室网站内容编辑器（macOS / Linux）
set -e
cd "$(dirname "$0")"

echo
echo "  ============================================"
echo "   实验室网站内容编辑器"
echo "  ============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  [错误] 没有找到 Node.js，请先安装：https://nodejs.org/"
  exit 1
fi
echo "  Node.js 版本：$(node -v)"

if [ -x ".bin/hugo" ]; then
  echo "  Hugo：.bin/hugo"
elif command -v hugo >/dev/null 2>&1; then
  echo "  Hugo：系统 PATH"
else
  echo "  [提示] 没有找到 hugo：可以改内容，但预览与「校验构建」不可用"
fi

# 已经在运行就直接打开，避免重复启动多个实例
RUNPORT="$(node tools/editor/find-running.mjs 2>/dev/null || true)"
if [ -n "$RUNPORT" ]; then
  echo
  echo "  检测到编辑器已在运行（端口 $RUNPORT），直接打开浏览器。"
  echo "  如需重启，请先关闭之前那个终端窗口。"
  URL="http://127.0.0.1:$RUNPORT/admin/"
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  else echo "  请手动访问：$URL"; fi
  exit 0
fi

echo
echo "  正在启动，请稍候（首次启动预览约 10 秒）..."
echo

exec node tools/editor/server.mjs --open "$@"
