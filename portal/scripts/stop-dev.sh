#!/usr/bin/env bash
set -euo pipefail

PORT_WEB=3000
PORT_AGENT=3847
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_PID_FILE="$ROOT/.dev/next-dev.pid"
AGENT_PID_FILE="$ROOT/.dev/media-agent.pid"

echo "[stop-dev] 释放 Web 端口 ${PORT_WEB} 与 Agent 端口 ${PORT_AGENT} …"
if PIDS=$(lsof -ti ":${PORT_WEB}" 2>/dev/null); then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi
if PIDS=$(lsof -ti ":${PORT_AGENT}" 2>/dev/null); then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

if [[ -f "$WEB_PID_FILE" ]]; then
  OLD="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD:-}" ]] && kill -0 "$OLD" 2>/dev/null; then
    kill -9 "$OLD" 2>/dev/null || true
  fi
  rm -f "$WEB_PID_FILE"
fi
if [[ -f "$AGENT_PID_FILE" ]]; then
  OLD="$(cat "$AGENT_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD:-}" ]] && kill -0 "$OLD" 2>/dev/null; then
    kill -9 "$OLD" 2>/dev/null || true
  fi
  rm -f "$AGENT_PID_FILE"
fi

sleep 1
if lsof -ti ":${PORT_WEB}" >/dev/null 2>&1 || lsof -ti ":${PORT_AGENT}" >/dev/null 2>&1; then
  echo "[stop-dev] 警告: 仍有端口被占用，可再次执行或手动检查。" >&2
else
  echo "[stop-dev] 已停止。"
fi
