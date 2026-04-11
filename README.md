# future

## `portal/`（唯一 Web 应用）

Next.js 单应用、**单端口**：个人主页 **Walter's world**（`/`）与各预留板块；**小川足球 / Mike 足球管理**在 **`/football`** 路径下。

- **主页逻辑**：`portal/hub/`（板块配置、首页网格、占位页组件）
- **足球子站**：`portal/app/(football)/football/`、`portal/components/` 中 Mike 相关部分、`portal/lib/` 数据层等

```bash
cd portal
npm install
npm run dev
```

开发端口固定为 **3000**。

- **后台重启**（关掉终端仍运行；日志在 `portal/.dev/next-dev.log`）：

```bash
cd portal && npm run restart
```

- **停止**：`cd portal && npm run stop`

浏览器访问 http://localhost:3000 。SQLite 与持久化仍使用仓库根目录 **`walter_data/`**（见 `portal/lib/persistence.ts`）。

Docker：在 `portal` 目录执行 `docker compose up --build`。
