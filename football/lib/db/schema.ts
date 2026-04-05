import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

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
