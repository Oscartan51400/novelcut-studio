#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

echo "正在启动 NovelCut Studio..."
echo "浏览器地址：http://127.0.0.1:5188"

(sleep 1.2; open "http://127.0.0.1:5188") &
npm run dev
