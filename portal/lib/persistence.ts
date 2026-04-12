import path from "path";

/**
 * 持久化数据根目录（SQLite、媒体索引、运行日志等）。默认仓库根目录 `walter_data/`。
 * 容器内需设置 `WALTER_DATA_DIR=/walter_data` 并挂载对应卷（见 docker-compose）。
 */
export function getPersistenceRoot(): string {
  if (process.env.WALTER_DATA_DIR) {
    return path.resolve(process.env.WALTER_DATA_DIR);
  }
  return path.resolve(process.cwd(), "..", "walter_data");
}
