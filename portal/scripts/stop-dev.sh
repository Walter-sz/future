#!/usr/bin/env bash
set -euo pipefail

PORT=3000
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/.dev/next-dev.pid"

echo "[stop-dev] 释放端口 ${PORT} …"
if PIDS=$(lsof -ti ":${PORT}" 2>/dev/null); then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

if [[ -f "$PID_FILE" ]]; then
  OLD="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD:-}" ]] && kill -0 "$OLD" 2>/dev/null; then
    kill -9 "$OLD" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

sleep 1
if lsof -ti ":${PORT}" >/dev/null 2>&1; then
  echo "[stop-dev] 警告: 端口 ${PORT} 仍有进程，可再次执行或手动检查。" >&2
else
  echo "[stop-dev] 已停止。"
fi
