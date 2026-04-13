# CrawlerAgent

基于 **LangGraph + Playwright（持久化 Chromium）** 的统一抓取服务，支持 **豆瓣 / 小红书 / X (Twitter)** 三站点。

提供 **REST**（`POST /v1/tasks/run`）和 **WebSocket**（`/v1/ws`）双协议访问，默认监听 **`0.0.0.0:5533`**。

## 功能

| site | task | 说明 |
|------|------|------|
| `douban` | `subject.resolve_by_title` | 按名称搜索影视并解析最匹配条目（评分、人数、演职员等） |
| `xiaohongshu` | `search.notes` | 按关键词搜索笔记（Gemini 排序 + 可选视觉判断 + QR 扫码登录） |
| `x` | `search.posts` | 通过 xmcp 搜索 X 推文（可选 Gemini 筛选，无需浏览器） |

**并发模型**：每个站点独立浏览器上下文，不同站点可并行；同站点内每个任务独占一个 Tab，通过 per-site 信号量（默认 3）控制并发。X 搜索无需浏览器，不受浏览器并发限制。

**产品约定（豆瓣电视剧）**：豆瓣上剧集多按「季」拆成独立条目，搜索/联想通常把 **第一季** 排在前列；本任务在 `kind_hint` 为 `tv`（或 `auto` 且命中电视搜索）时，**默认接受以第一季条目**作为该剧的代表信息。

## 安装

```bash
cd crawler-agent
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
playwright install chromium
# Linux 服务器可能还需要:
# playwright install-deps chromium
```

## 环境变量

### 服务端通用

| 变量 | 说明 |
|------|------|
| `CRAWLER_HOST` | 默认 `0.0.0.0` |
| `CRAWLER_PORT` | 默认 `5533` |
| `CRAWLER_API_KEY` | 若设置则请求头必须带 `X-Api-Key: <值>`（WS 在消息中传 `api_key`） |
| `CRAWLER_PROFILE_DIR` | 浏览器 profile 根目录，默认 `./data/browser-profiles` |
| `CRAWLER_COVER_CACHE_DIR` | 豆瓣封面落盘目录，默认 `./data/covers` |
| `CRAWLER_PUBLIC_BASE_URL` | 可选，如 `http://192.168.124.24:5533` |
| `CRAWLER_DEFAULT_TIMEOUT_MS` | 默认 `120000` |
| `CRAWLER_MAX_CONCURRENT_TASKS` | 全局并发上限，默认 `5` |
| `CRAWLER_MAX_CONCURRENT_PER_SITE` | 每站点 Tab 并发上限，默认 `3` |

### X (Twitter)

| 变量 | 说明 |
|------|------|
| `CRAWLER_XMCP_URL` | xmcp MCP 端点，默认 `http://127.0.0.1:8000/mcp` |
| `CRAWLER_X_SEARCH_MAX_RESULTS` | X API 搜索最大返回条数，默认 `50` |
| `CRAWLER_X_MAX_POSTS` | Gemini 筛选后最终返回条数，默认 `12` |

### Gemini（X + XHS 共用）

| 变量 | 说明 |
|------|------|
| `CRAWLER_GOOGLE_API_KEY` | Google Gemini API Key（未设置则跳过 AI 排序） |
| `CRAWLER_GEMINI_MODEL` | 模型名，默认 `gemini-2.5-flash` |
| `CRAWLER_GEMINI_REQUEST_TIMEOUT_S` | 超时秒数，默认 `120` |

### XHS 增强

| 变量 | 说明 |
|------|------|
| `CRAWLER_XHS_HEADLESS` | 是否无头运行（留空则 macOS 有头，其它无头） |
| `CRAWLER_XHS_SEARCH_SCROLL_ROUNDS` | 搜索页滚动次数，默认 `9` |
| `CRAWLER_XHS_MAX_POSTS` | 最终返回条数，默认 `12` |
| `CRAWLER_XHS_GEMINI_USE_VISION` | 是否启用封面多模态判断，默认 `true` |
| `CRAWLER_XHS_LOGIN_TIMEOUT_S` | QR 扫码登录超时秒数，默认 `120` |

## 登录态（持久化）

首次或 Cookie 失效时，在**有图形界面**的机器上执行：

```bash
python -m crawler_agent login douban
python -m crawler_agent login xiaohongshu
```

完成登录后终端按 Enter，数据写入 `data/browser-profiles/<site>/`。

X (Twitter) 无需浏览器登录——通过 xmcp MCP server 使用 API 凭证。

## 启动

```bash
uvicorn crawler_agent.main:app --host 0.0.0.0 --port 5533
# 或
crawler-agent
```

## REST API 示例

```bash
# 健康检查
curl -s http://127.0.0.1:5533/health

# 查看任务目录
curl -s http://127.0.0.1:5533/v1/tasks

# 豆瓣搜索
curl -s http://127.0.0.1:5533/v1/tasks/run \
  -H "Content-Type: application/json" \
  -d '{"site":"douban","task":"subject.resolve_by_title","params":{"title":"肖申克的救赎"}}'

# X 搜索
curl -s http://127.0.0.1:5533/v1/tasks/run \
  -H "Content-Type: application/json" \
  -d '{"site":"x","task":"search.posts","params":{"query":"Tokyo travel"}}'

# 小红书搜索
curl -s http://127.0.0.1:5533/v1/tasks/run \
  -H "Content-Type: application/json" \
  -d '{"site":"xiaohongshu","task":"search.notes","params":{"query":"咖啡推荐","limit":10}}'
```

## WebSocket 协议

连接 `ws://127.0.0.1:5533/v1/ws`，发送：

```json
{
  "type": "run",
  "site": "xiaohongshu",
  "task": "search.notes",
  "params": { "query": "旅行攻略" },
  "api_key": "yourkey"
}
```

服务端推送（任意数量）：

```json
{"type": "status",  "message": "正在搜索..."}
{"type": "qr_code", "image": "data:image/png;base64,..."}
{"type": "result",  "platform": "xhs", "cards": [...]}
{"type": "done",    "ok": true, "data": {...}}
```

支持 `ping` / `pong` 心跳。单连接可发送多次 `run` 消息。

## 资源库条目豆瓣补全（独立 CLI）

与 **Portal / Walter 共用** `WALTER_DATA_DIR/app.db` 中的 `media_work` 表及 `WALTER_DATA_DIR/media/metadata/*.json` 侧车文件。

**豆瓣解析默认走局域网 HTTP**（`POST {CRAWLER_AGENT_URL}/v1/tasks/run`，未设置 `CRAWLER_AGENT_URL` 时默认 **`http://192.168.124.24:5533`**）。系列/合集片名会先经 **Gemini**（`GEMINI_API_KEY`）拆成短检索词再请求 crawler；若 crawler 启用了鉴权，本机需设置 **`CRAWLER_API_KEY`**（请求头 `X-Api-Key`）。需要本机 Playwright 时加 **`--local-douban`**。

批量补全 **仅允许** 处理尚无 `douban_rating` 的条目：须指定 **`--only-incomplete-douban`** 或 **`--skip-if-douban-rating`**（与 `--all-library` 联用），避免对已补全条目全量重跑。

```bash
cd crawler-agent && source .venv/bin/activate && pip install -e .
# 干跑
python -m crawler_agent.tools.enrich_library_douban --config config/enrich-douban.examples.yaml --dry-run
# 正式写库
python -m crawler_agent.tools.enrich_library_douban --config config/enrich-douban.examples.yaml
# 仅补全无豆瓣评分（影+剧），默认 HTTP 调局域网 crawler-agent
python -m crawler_agent.tools.enrich_library_douban --all-library --only-incomplete-douban
# 指定其它 crawler 地址
CRAWLER_AGENT_URL=http://192.168.1.10:5533 python -m crawler_agent.tools.enrich_library_douban --all-library --only-incomplete-douban
# 强制本机浏览器拉豆瓣（不使用 HTTP）
python -m crawler_agent.tools.enrich_library_douban --all-library --only-incomplete-douban --local-douban
```

## systemd 部署

见 [deploy/crawler-agent.service](deploy/crawler-agent.service)。
