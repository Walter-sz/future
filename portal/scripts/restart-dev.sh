#!/usr/bin/env bash
set -euo pipefail

PORT=3000
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEV_DIR="$ROOT/.dev"
mkdir -p "$DEV_DIR"
PID_FILE="$DEV_DIR/next-dev.pid"
LOG_FILE="$DEV_DIR/next-dev.log"

echo "[restart-dev] 释放端口 ${PORT} …"
if PIDS=$(lsof -ti ":${PORT}" 2>/dev/null); then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD:-}" ]] && kill -0 "$OLD" 2>/dev/null; then
    kill -9 "$OLD" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

if lsof -ti ":${PORT}" >/dev/null 2>&1; then
  echo "[restart-dev] 错误: 端口 ${PORT} 仍被占用，请手动检查。" >&2
  exit 1
fi

echo "[restart-dev] 后台启动 next dev（端口 ${PORT}）…"
: >"$LOG_FILE"
nohup npm run dev >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

echo "[restart-dev] 已启动，PID $(cat "$PID_FILE")（关闭终端不影响服务）。"
echo "[restart-dev] 日志: $LOG_FILE"
echo "[restart-dev] 跟踪日志: tail -f \"$LOG_FILE\""
echo "[restart-dev] 停止服务: npm run stop"
