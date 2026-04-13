#!/usr/bin/env bash
# crawler-agent 一键启动（自动初始化 venv + 安装依赖 + 启动服务）
#
# 用法:
#   ./scripts/start.sh            # 前台启动（默认，Ctrl+C 停止）
#   ./scripts/start.sh --bg       # 后台启动
#   CRAWLER_PORT=5533 ./scripts/start.sh
#
# 环境变量（可写入项目根 .env 文件）:
#   CRAWLER_PORT              默认 5533
#   CRAWLER_GOOGLE_API_KEY    Gemini API Key（可选，不设则跳过 AI 排序）
#   CRAWLER_XMCP_URL          xmcp 端点（默认 http://127.0.0.1:8000/mcp）
#   CRAWLER_API_KEY            访问鉴权 Key（可选）

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 加载 .env（如果存在）
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export CRAWLER_PORT="${CRAWLER_PORT:-5533}"
export CRAWLER_HOST="${CRAWLER_HOST:-0.0.0.0}"

BACKGROUND=false
for arg in "$@"; do
  case "$arg" in
    --bg|--background) BACKGROUND=true ;;
  esac
done

cd "$ROOT"

# macOS：系统 /usr/bin/python3 常为 3.9；Homebrew 在 /opt/homebrew 或 /usr/local（须先于下述探测）
if [[ "$(uname -s)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

# ── 1. 确保 venv 存在（需要 Python 3.10+）───────────

PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "❌ 未找到 Python 3.10+，请先安装（brew install python@3.13）"
  exit 1
fi

if [ ! -f "$ROOT/.venv/bin/activate" ]; then
  echo "📦 创建 Python venv（$($PYTHON --version)）..."
  "$PYTHON" -m venv "$ROOT/.venv"
fi

# shellcheck disable=SC1091
source "$ROOT/.venv/bin/activate"

# ── 2. 确保依赖已安装 ────────────────────────────────

if ! python -c "import crawler_agent" 2>/dev/null; then
  echo "📦 升级 pip..."
  pip install --upgrade pip --quiet
  echo "📦 安装 crawler-agent 及依赖..."
  pip install -e "$ROOT" --quiet
fi

# ── 3. 确保 Playwright Chromium 已安装 ───────────────

if ! playwright install --dry-run chromium 2>/dev/null | grep -q "is already installed" 2>/dev/null; then
  echo "🌐 安装 Playwright Chromium..."
  playwright install chromium
fi

# ── 4. 停止已有进程（如果端口被占） ──────────────────

old_pids=$(lsof -tiTCP:"$CRAWLER_PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$old_pids" ]; then
  echo "⏹  停止占用端口 $CRAWLER_PORT 的旧进程: $old_pids"
  kill -TERM $old_pids 2>/dev/null || true
  sleep 1
fi

# ── 5. 启动 ──────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "  crawler-agent 启动中"
echo "  监听:   $CRAWLER_HOST:$CRAWLER_PORT"
echo "  REST:   http://$CRAWLER_HOST:$CRAWLER_PORT/v1/tasks/run"
echo "  WS:     ws://$CRAWLER_HOST:$CRAWLER_PORT/v1/ws"
echo "════════════════════════════════════════"
echo ""

if [ "$BACKGROUND" = true ]; then
  mkdir -p "$ROOT/logs"
  LOG_FILE="$ROOT/logs/crawler-agent.log"
  nohup crawler-agent >> "$LOG_FILE" 2>&1 &
  PID=$!
  sleep 2
  if kill -0 "$PID" 2>/dev/null; then
    echo "✅ crawler-agent 已在后台启动 (PID: $PID)"
    echo "   日志: tail -f $LOG_FILE"
    echo "   停止: kill $PID"
  else
    echo "❌ 启动失败，请查看日志:"
    tail -20 "$LOG_FILE"
    exit 1
  fi
else
  exec crawler-agent
fi
