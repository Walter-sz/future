# Walter's world（portal）

开发默认端口 **3000**。`npm run restart` 会释放冲突端口后后台同时启动：

- Web（`next dev -p 3000`）
- 影视资源 Agent（独立目录 `../agent-media`，端口 `3847`）

日志：

- `portal/.dev/next-dev.log`
- `portal/.dev/media-agent.log`

`npm run stop` 会同时停止两者（见 `scripts/restart-dev.sh`、`scripts/stop-dev.sh`）。

单应用包含：

- **`hub/`**：个人主页板块配置与 UI（Walter's world 首页、占位页）
- **`app/(walter)/`**：路由 `/`、`/study`、`/photos`、`/movies`、`/world`
- **`app/(football)/football/`**：Mike 足球管理（`/football` 及子路由）

数据库与对照图目录仍指向仓库根的 `../walter_data/`。
