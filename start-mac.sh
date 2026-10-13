#!/bin/bash
# 一鍵啟動：MediaMTX + 轉播伺服器，並防止 Mac 進入睡眠
cd "$(dirname "$0")"

command -v mediamtx >/dev/null || { echo "請先執行：brew install mediamtx"; exit 1; }
command -v ffmpeg   >/dev/null || { echo "請先執行：brew install ffmpeg";   exit 1; }
command -v node     >/dev/null || { echo "請先執行：brew install node";     exit 1; }
[ -d node_modules ] || npm install

trap 'kill 0' EXIT INT TERM

mediamtx ./mediamtx.yml &
sleep 2
caffeinate -dims node relay-server.js &

wait
