import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __sqlite?: Database.Database;
  __bootstrapped?: boolean;
};

function getDbPath(): string {
  const dir = process.env.SQLITE_DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(dir, "app.db");
}

function migrateWeeklySpeedIllinoisRun(raw: Database.Database) {
  try {
    const rows = raw.prepare("PRAGMA table_info(weekly_speed)").all() as { name: string }[];
    if (rows.length === 0) return;
    const names = new Set(rows.map((r) => r.name));
    if (names.has("sprint_100m") && !names.has("illinois_run_sec")) {
      raw.exec(`ALTER TABLE weekly_speed RENAME COLUMN sprint_100m TO illinois_run_sec`);
    }
  } catch {
    /* SQLite 版本过旧等 */
  }
}

function ensureSchema(raw: Database.Database) {
  if (globalForDb.__bootstrapped) return;
  raw.exec(`
    CREATE TABLE IF NOT EXISTS weekly_anthropometric (
      week_start TEXT PRIMARY KEY NOT NULL,
      height_cm REAL,
      weight_kg REAL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_speed (
      week_start TEXT PRIMARY KEY NOT NULL,
      sprint_10m REAL,
      sprint_30m REAL,
      illinois_run_sec REAL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_activity (
      week_start TEXT PRIMARY KEY NOT NULL,
      training_count INTEGER,
      match_count INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_slot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      hour INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      UNIQUE(week_start, weekday, hour)
    );
    CREATE TABLE IF NOT EXISTS short_term_goal (
      id INTEGER PRIMARY KEY NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
  migrateWeeklySpeedIllinoisRun(raw);
  const now = Date.now();
  raw
    .prepare(
      "INSERT OR IGNORE INTO short_term_goal (id, content, updated_at) VALUES (1, '', ?)"
    )
    .run(now);
  globalForDb.__bootstrapped = true;
}

export function getDb() {
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!globalForDb.__sqlite) {
    globalForDb.__sqlite = new Database(dbPath);
    ensureSchema(globalForDb.__sqlite);
  }
  return drizzle(globalForDb.__sqlite, { schema });
}

export function getRawSqlite(): Database.Database {
  getDb();
  return globalForDb.__sqlite!;
}
