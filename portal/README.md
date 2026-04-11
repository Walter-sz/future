# Walter's world（portal）

开发默认端口 **3000**。`npm run restart`：释放 3000 后用 `nohup` 后台起 `next dev`，日志 ` .dev/next-dev.log`；`npm run stop` 结束服务（见 `scripts/restart-dev.sh`、`scripts/stop-dev.sh`）。

单应用包含：

- **`hub/`**：个人主页板块配置与 UI（Walter's world 首页、占位页）
- **`app/(walter)/`**：路由 `/`、`/study`、`/photos`、`/movies`、`/world`
- **`app/(football)/football/`**：Mike 足球管理（`/football` 及子路由）

数据库与对照图目录仍指向仓库根的 `../walter_data/`。
