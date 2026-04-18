# 本地密钥说明（勿将本目录内除本文件外的内容提交到 Git）

本仓库根目录 `.gitignore` 已忽略 `secrets/*`（本 `README.md` 除外）。

## 推荐文件

| 文件 | 用途 |
|------|------|
| `local.env` | 汇总密钥，仅供本机 `source` 或手工复制到各子项目（**不要** `git add`） |
| `lan-environment.md` | **本机局域网拓扑**（如 Mac mini / NAS 的 IP、部署路径）；**勿提交**，仅本地保留 |

## 各子项目如何加载

- **crawler-agent**：在项目根 [`crawler-agent/.env`](../crawler-agent/) 中配置；[`scripts/start.sh`](../crawler-agent/scripts/start.sh) 会自动 `source` 该文件。服务内 Gemini 使用 **`CRAWLER_GOOGLE_API_KEY`**。豆瓣补全脚本 **`enrich_library_douban`** 默认 **`POST`** 局域网 **`CRAWLER_AGENT_URL`**（不设则脚本内默认 `http://192.168.124.24:5533`）；若 crawler 开了鉴权，另设 **`CRAWLER_API_KEY`**。系列名解析另需 **`GEMINI_API_KEY`**（可与 `CRAWLER_GOOGLE_API_KEY` 同源）。
- **agent-media**：在 [`agent-media/.env`](../agent-media/) 中配置 **`GEMINI_API_KEY`**。`server.ts` 入口已 `import "dotenv/config"`，启动时会自动加载同目录下的 `.env`（勿提交）。
- **X (Twitter)**：crawler-agent 通过 **xmcp** 调 X API，Consumer/Secret/Bearer 应配置在 **xmcp 服务** 的运行环境中；`local.env` 里仅作你本机备份，便于复制到 xmcp 的 `.env`。

## 轮换与泄露

若密钥曾出现在聊天或日志中，建议在 Google Cloud / X Developer Portal **轮换** 后再更新本地 `.env`。
