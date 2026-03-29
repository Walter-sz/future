# Mike 足球管理（Web）

Next.js（App Router）+ TypeScript + Tailwind + SQLite（better-sqlite3 + Drizzle）的家庭用足球成长管理应用。首期包含 **Portal**（周维图表、可编辑周课表、短期目标）及另外三个 Tab 的占位页。

## 环境要求

- Node.js 22+（建议 LTS）
- npm 或 pnpm

## 本地运行

```bash
cd football
npm install
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。

首次启动会在 `data/app.db` 自动创建 SQLite 数据库与表结构（若目录不存在会自动创建）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `TZ` | 建议设为 `Asia/Shanghai`，保证「本周」与周起始日期一致 |
| `SQLITE_DATA_DIR` | 可选，数据库目录，默认 `<项目根>/data`（库文件为 `app.db`） |

示例：

```bash
export TZ=Asia/Shanghai
export SQLITE_DATA_DIR=/var/lib/mike-football
npm run start
```

## 生产构建

```bash
cd football
npm install
npm run build
npm run start
```

默认监听 `3000` 端口。无登录保护，请勿直接暴露到不可信公网；建议家庭内网、VPN 或反向代理访问控制。

## Drizzle（可选）

表结构由 `lib/db/index.ts` 在首次连接时 `CREATE TABLE IF NOT EXISTS` 引导。若你改用迁移工作流：

```bash
npm run db:generate
npm run db:push
```

`drizzle.config.ts` 中 `dbCredentials.url` 可通过环境变量 `DRIZZLE_DB_PATH` 覆盖。

## Docker 与数据卷

在 `football` 目录：

```bash
docker compose up --build
```

`docker-compose.yml` 将宿主 `./data` 挂载到容器内 `/app/data`，以持久化 SQLite。修改代码后重新 `docker compose build`。

单独构建镜像：

```bash
docker build -t mike-football .
```

## 路由说明

- `/`：Portal（查询参数 `?week=YYYY-MM-DD` 可切换课表周，自动对齐到当周周一）
- `/portal/data/anthropometric`、`/portal/data/speed`、`/portal/data/activity`：三类周数据的表格增删改
- 身高/体重页含两个子 Tab：「原始数据」与「身高体重对照表」。将对照表图片（`.png` / `.jpg` / `.webp` / `.gif`）放在 `football/images/` 下，第二个 Tab 会自动列出并展示（经 `/api/ref-image/[name]` 读取）
- `/media`、`/skills`、`/game-reading`：占位页，待后续开发

## 项目结构（节选）

- `app/(main)/`：主导航与各 Tab 页面
- `app/actions/data.ts`：Server Actions（写库）
- `lib/db/`：Drizzle schema 与连接
- `components/portal/`：图表、课表、短期目标
- `components/data-tables/`：TanStack Table 数据表
- `images/`：身高体重标准对照表等参考图片（可选）
