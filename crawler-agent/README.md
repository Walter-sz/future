# CrawlerAgent

基于 **LangGraph + Playwright（持久化 Chromium）** 的内网抓取服务：统一入口 `POST /v1/tasks/run`，默认监听 **`0.0.0.0:5533`**。

## 功能

| site | task | 说明 |
|------|------|------|
| `douban` | `subject.resolve_by_title` | 按名称搜索影视并解析最匹配条目（评分、人数、演职员等） |
| `xiaohongshu` | `search.notes` | 按关键词搜索笔记，返回前 N 条（DOM 依赖强，可能需登录） |

**产品约定（豆瓣电视剧）**：豆瓣上剧集多按「季」拆成独立条目，搜索/联想通常把 **第一季** 排在前列；本任务在 `kind_hint` 为 `tv`（或 `auto` 且命中电视搜索）时，**默认接受以第一季条目**作为该剧的代表信息（海报、评分人数、简介等均来自该季页面）。

## 安装（开发机或 192.168.124.24）

```bash
cd crawler-agent
# 需要 Python 3.10+（推荐 3.12）
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
playwright install chromium
# Linux 服务器可能还需要:
# playwright install-deps chromium
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `CRAWLER_HOST` | 默认 `0.0.0.0` |
| `CRAWLER_PORT` | 默认 `5533` |
| `CRAWLER_API_KEY` | 若设置则请求头必须带 `X-Api-Key: <值>` |
| `CRAWLER_PROFILE_DIR` | 浏览器 profile 根目录，默认 `./data/browser-profiles` |
| `CRAWLER_COVER_CACHE_DIR` | 豆瓣封面落盘目录，默认 `./data/covers`（经本服务 `GET /static/covers/<文件名>` 可直接访问；若豆瓣 CDN 返回 418 等，会自动改为截取条目页 `#mainpic` 海报为 JPEG） |
| `CRAWLER_PUBLIC_BASE_URL` | 可选，如 `http://192.168.124.24:5533`（无尾斜杠）；设置后接口会在 `data.coverUrlCached` 中返回可直接打开的完整封面 URL |
| `CRAWLER_DEFAULT_TIMEOUT_MS` | 默认 `120000` |

## 登录态（持久化）

首次或 Cookie 失效时，在**有图形界面**的机器上执行：

```bash
python -m crawler_agent login douban
python -m crawler_agent login xiaohongshu
```

完成登录后终端按 Enter，数据写入 `data/browser-profiles/<site>/`。

## 资源库条目豆瓣补全（独立 CLI）

与 **Portal / Walter 共用** `WALTER_DATA_DIR/app.db` 中的 `media_work` 表及 `WALTER_DATA_DIR/media/metadata/*.json` 侧车文件；**不经过** agent-media 入库图，仅按配置逐条调用本仓库内的豆瓣 LangGraph 并 **UPDATE** 已有行。

**前置**：同登录节，建议在有图形界面环境完成豆瓣登录；封面抓取默认 **headed** 更稳（可用 `--no-force-headed` 尝试无头）。

**环境变量**

| 变量 | 说明 |
|------|------|
| `WALTER_DATA_DIR` | Walter 数据根（含 `app.db`、`media/metadata/`）。未设置时，若本包位于 `future/crawler-agent/` 布局，则默认使用 `future/walter_data` |
| `CRAWLER_PUBLIC_BASE_URL` | 可选；设置后豆瓣结果中可带 `coverUrlCached`，便于海报使用本服务静态地址 |

**配置文件**：YAML，根键 `entries`，每项含 `search_title`、`kind_hint`（`auto` \| `movie` \| `tv`）、`nas_library_path`（须与库里 **`nas_library_path` 完全一致**）。示例见 [config/enrich-douban.examples.yaml](config/enrich-douban.examples.yaml)。

**命令**

```bash
cd crawler-agent && source .venv/bin/activate && pip install -e .
# 干跑（不写库）
python -m crawler_agent.tools.enrich_library_douban --config config/enrich-douban.examples.yaml --dry-run
# 正式写库（串行，条间约 1s）
python -m crawler_agent.tools.enrich_library_douban --config config/enrich-douban.examples.yaml

# 资源库内全部条目（与 Portal 相同 NAS 前缀规则；用 title_zh 搜豆瓣）
export WALTER_DATA_DIR=/path/to/walter_data
export NAS_LIBRARY_ROOT=/volume1/homes/影视资源库   # 可选，默认值同上
python -m crawler_agent.tools.enrich_library_douban --all-library --skip-if-douban-rating
# 断点续跑：已处理 50 条后
python -m crawler_agent.tools.enrich_library_douban --all-library --skip-if-douban-rating --offset 50
# 仅试跑前 5 条
python -m crawler_agent.tools.enrich_library_douban --all-library --limit 5 --dry-run
```

Portal 列表依赖 `NAS_LIBRARY_ROOT` 与库路径前缀一致；若仅本地演示，请保持与 `media_work.nas_library_path` 相同前缀。

**海报在网页显示**：豆瓣 CDN 对站外 `Referer` 常拦截，补全脚本在本地封面存在时会将 `poster_url` 写成 **`/api/media/douban-cover/<豆瓣subject数字ID>`**，由 Portal 同域读 `CRAWLER_COVER_CACHE_DIR`（默认 monorepo 下 `../crawler-agent/data/covers`）。部署时请在 Portal 环境设置 **`DOUBAN_COVER_CACHE_DIR`** 指向实际封面目录。

## 启动

```bash
uvicorn crawler_agent.main:app --host 0.0.0.0 --port 5533
# 或
crawler-agent
```

## API 示例

```bash
curl -s http://127.0.0.1:5533/health

curl -s http://127.0.0.1:5533/v1/tasks -H "X-Api-Key: yourkey"

curl -s http://127.0.0.1:5533/v1/tasks/run -H "Content-Type: application/json" -H "X-Api-Key: yourkey" \
  -d '{"site":"douban","task":"subject.resolve_by_title","params":{"title":"肖申克的救赎","kind_hint":"auto"}}'
```

## systemd（部署到 OpenClaw 目录时参考）

见 [deploy/crawler-agent.service](deploy/crawler-agent.service)。将 `WorkingDirectory`、`User` 改为远端实际路径与用户。

## 同步到 192.168.124.24

将本目录 `rsync` 到 `walter@192.168.124.24:/Users/walter/Desktop/projects/OpenClaw/crawler-agent` 后，在远端重复安装与 `systemctl` 步骤即可。
