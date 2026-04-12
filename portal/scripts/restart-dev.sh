#!/usr/bin/env bash
set -euo pipefail

PORT_WEB=3000
PORT_AGENT=3847
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_ROOT="$(cd "$ROOT/.." && pwd)/agent-media"
AGENT_ENV_FILE="$ROOT/.env.agent.local"
cd "$ROOT"

if [[ ! -d "$AGENT_ROOT" ]]; then
  echo "[restart-dev] 错误: 找不到 agent 目录 $AGENT_ROOT" >&2
  exit 1
fi

if [[ -f "$AGENT_ENV_FILE" ]]; then
  echo "[restart-dev] 加载 Agent 环境变量: $AGENT_ENV_FILE"
  set -a
  # shellcheck source=/dev/null
  source "$AGENT_ENV_FILE"
  set +a
fi

DEV_DIR="$ROOT/.dev"
mkdir -p "$DEV_DIR"
WEB_PID_FILE="$DEV_DIR/next-dev.pid"
WEB_LOG_FILE="$DEV_DIR/next-dev.log"
AGENT_PID_FILE="$DEV_DIR/media-agent.pid"
AGENT_LOG_FILE="$DEV_DIR/media-agent.log"

echo "[restart-dev] 释放 Web 端口 ${PORT_WEB} 与 Agent 端口 ${PORT_AGENT} …"
if PIDS=$(lsof -ti ":${PORT_WEB}" 2>/dev/null); then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi
if PIDS=$(lsof -ti ":${PORT_AGENT}" 2>/dev/null); then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi
sleep 1

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

if lsof -ti ":${PORT_WEB}" >/dev/null 2>&1; then
  echo "[restart-dev] 错误: Web 端口 ${PORT_WEB} 仍被占用，请手动检查。" >&2
  exit 1
fi
if lsof -ti ":${PORT_AGENT}" >/dev/null 2>&1; then
  echo "[restart-dev] 错误: Agent 端口 ${PORT_AGENT} 仍被占用，请手动检查。" >&2
  exit 1
fi

echo "[restart-dev] 后台启动 next dev（端口 ${PORT_WEB}）…"
: >"$WEB_LOG_FILE"
nohup npm run dev >>"$WEB_LOG_FILE" 2>&1 &
echo $! >"$WEB_PID_FILE"

echo "[restart-dev] 后台启动影视资源 Agent（端口 ${PORT_AGENT}）…"
: >"$AGENT_LOG_FILE"
nohup bash -lc "cd \"$AGENT_ROOT\" && npm run dev" >>"$AGENT_LOG_FILE" 2>&1 &
echo $! >"$AGENT_PID_FILE"

echo "[restart-dev] 已启动："
echo "  - Web   PID $(cat "$WEB_PID_FILE")    http://localhost:${PORT_WEB}"
echo "  - Agent PID $(cat "$AGENT_PID_FILE")  http://127.0.0.1:${PORT_AGENT}/health"
echo "[restart-dev] 日志："
echo "  - Web   $WEB_LOG_FILE"
echo "  - Agent $AGENT_LOG_FILE"
echo "[restart-dev] 跟踪日志：tail -f \"$WEB_LOG_FILE\" \"$AGENT_LOG_FILE\""
echo "[restart-dev] 停止服务: npm run stop"
