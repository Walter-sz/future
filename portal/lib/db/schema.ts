import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const weeklyAnthropometric = sqliteTable("weekly_anthropometric", {
  weekStart: text("week_start").primaryKey(),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const weeklySpeed = sqliteTable("weekly_speed", {
  weekStart: text("week_start").primaryKey(),
  sprint10m: real("sprint_10m"),
  sprint30m: real("sprint_30m"),
  illinoisRunSec: real("illinois_run_sec"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const weeklyActivity = sqliteTable("weekly_activity", {
  weekStart: text("week_start").primaryKey(),
  trainingCount: integer("training_count"),
  matchCount: integer("match_count"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const scheduleSlot = sqliteTable(
  "schedule_slot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    weekStart: text("week_start").notNull(),
    weekday: integer("weekday").notNull(),
    hour: integer("hour").notNull(),
    label: text("label").notNull().default(""),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("schedule_slot_week_hour").on(t.weekStart, t.weekday, t.hour)]
);

export const shortTermGoal = sqliteTable("short_term_goal", {
  id: integer("id").primaryKey(),
  content: text("content").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mediaWork = sqliteTable(
  "media_work",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    titleZh: text("title_zh").notNull(),
    titleEn: text("title_en").notNull().default(""),
    normalizedTitle: text("normalized_title").notNull().default(""),
    mediaType: text("media_type").notNull().default("movie"),
    year: integer("year"),
    country: text("country"),
    language: text("language"),
    tmdbType: text("tmdb_type"),
    tmdbId: integer("tmdb_id"),
    tmdbRating: real("tmdb_rating"),
    doubanRating: real("douban_rating"),
    matchStatus: text("match_status").notNull().default("unresolved"),
    summary: text("summary"),
    directorsJson: text("directors_json").notNull().default("[]"),
    actorsJson: text("actors_json").notNull().default("[]"),
    posterUrl: text("poster_url"),
    nasLibraryPath: text("nas_library_path").notNull(),
    metadataPath: text("metadata_path"),
    searchText: text("search_text").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("media_work_path_unique").on(t.nasLibraryPath),
    uniqueIndex("media_work_tmdb_unique").on(t.tmdbType, t.tmdbId),
  ]
);

export const mediaTag = sqliteTable("media_tag", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const mediaWorkTag = sqliteTable(
  "media_work_tag",
  {
    workId: integer("work_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workId, t.tagId] })]
);

export const mediaAgentRun = sqliteTable("media_agent_run", {
  id: text("id").primaryKey(),
  triggerSource: text("trigger_source").notNull().default("manual"),
  status: text("status").notNull().default("queued"),
  dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
  totalItems: integer("total_items"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  summary: text("summary"),
});

export const mediaAgentRunEvent = sqliteTable(
  "media_agent_run_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    level: text("level").notNull().default("info"),
    node: text("node"),
    message: text("message").notNull(),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("media_agent_run_event_idx").on(t.runId, t.id)]
);
