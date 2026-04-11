import path from "path";

/**
 * 持久化数据根目录（SQLite、对照图等）。默认与 `football` 同级的仓库根目录下 `walter_data/`。
 * 容器内需设置 `WALTER_DATA_DIR=/walter_data` 并挂载对应卷（见 docker-compose）。
 */
export function getPersistenceRoot(): string {
  if (process.env.WALTER_DATA_DIR) {
    return path.resolve(process.env.WALTER_DATA_DIR);
  }
  return path.resolve(process.cwd(), "..", "walter_data");
}
