import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import { getPersistenceRoot } from "@/lib/persistence";
import { ensureMediaDataDirs } from "@/lib/media-storage";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __sqlite?: Database.Database;
  __bootstrapped?: boolean;
};

function getDbPath(): string {
  const dir = process.env.SQLITE_DATA_DIR ?? getPersistenceRoot();
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

function migrateMediaWorkWatchColumns(raw: Database.Database) {
  try {
    const rows = raw.prepare("PRAGMA table_info(media_work)").all() as { name: string }[];
    if (rows.length === 0) return;
    const names = new Set(rows.map((r) => r.name));
    if (!names.has("watch_status")) {
      raw.exec(`ALTER TABLE media_work ADD COLUMN watch_status TEXT NOT NULL DEFAULT 'unwatched'`);
    }
    if (!names.has("watched_at")) {
      raw.exec(`ALTER TABLE media_work ADD COLUMN watched_at INTEGER`);
    }
  } catch {
    /* ignore */
  }
}

const MEDIA_TAG_SEED_ROWS: [string, string][] = [
  ["action", "动作"],
  ["comedy", "喜剧"],
  ["drama", "剧情"],
  ["sci-fi", "科幻"],
  ["thriller", "悬疑"],
  ["horror", "恐怖"],
  ["animation", "动画"],
  ["war", "战争"],
  ["romance", "爱情"],
  ["documentary", "纪录"],
  ["fantasy", "奇幻"],
  ["crime", "犯罪"],
  ["family", "家庭"],
  ["history", "历史"],
  ["mystery", "推理"],
];

function seedMediaTags(raw: Database.Database) {
  try {
    const ins = raw.prepare("INSERT OR IGNORE INTO media_tag(slug, name) VALUES (?, ?)");
    for (const [slug, name] of MEDIA_TAG_SEED_ROWS) {
      ins.run(slug, name);
    }
  } catch {
    /* ignore */
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
    CREATE TABLE IF NOT EXISTS media_work (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_zh TEXT NOT NULL,
      title_en TEXT NOT NULL DEFAULT '',
      normalized_title TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'movie',
      year INTEGER,
      country TEXT,
      language TEXT,
      tmdb_type TEXT,
      tmdb_id INTEGER,
      tmdb_rating REAL,
      douban_rating REAL,
      match_status TEXT NOT NULL DEFAULT 'unresolved',
      summary TEXT,
      directors_json TEXT NOT NULL DEFAULT '[]',
      actors_json TEXT NOT NULL DEFAULT '[]',
      poster_url TEXT,
      nas_library_path TEXT NOT NULL,
      metadata_path TEXT,
      search_text TEXT NOT NULL DEFAULT '',
      watch_status TEXT NOT NULL DEFAULT 'unwatched',
      watched_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS media_work_path_unique ON media_work(nas_library_path);
    CREATE UNIQUE INDEX IF NOT EXISTS media_work_tmdb_unique ON media_work(tmdb_type, tmdb_id);
    CREATE TABLE IF NOT EXISTS media_tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_work_tag (
      work_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(work_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS media_agent_run (
      id TEXT PRIMARY KEY NOT NULL,
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'queued',
      dry_run INTEGER NOT NULL DEFAULT 1,
      total_items INTEGER,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS media_agent_run_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      node TEXT,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_agent_run_event_idx ON media_agent_run_event(run_id, id);
  `);
  migrateWeeklySpeedIllinoisRun(raw);
  migrateMediaWorkWatchColumns(raw);
  seedMediaTags(raw);
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
  ensureMediaDataDirs();
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
