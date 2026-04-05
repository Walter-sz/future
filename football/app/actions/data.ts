"use server";

import { getDb, getRawSqlite } from "@/lib/db";
import { weeklyAnthropometric, weeklySpeed, shortTermGoal } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const revalidatePortal = () => {
  revalidatePath("/");
  revalidatePath("/portal/data/anthropometric");
  revalidatePath("/portal/data/speed");
  revalidatePath("/portal/data/activity");
};

export async function upsertAnthropometricRow(
  weekStart: string,
  heightCm: number | null,
  weightKg: number | null
) {
  const db = getDb();
  const now = new Date();
  await db
    .insert(weeklyAnthropometric)
    .values({ weekStart, heightCm, weightKg, updatedAt: now })
    .onConflictDoUpdate({
      target: weeklyAnthropometric.weekStart,
      set: { heightCm, weightKg, updatedAt: now },
    });
  revalidatePortal();
}

export async function deleteAnthropometricRow(weekStart: string) {
  const db = getDb();
  await db.delete(weeklyAnthropometric).where(eq(weeklyAnthropometric.weekStart, weekStart));
  revalidatePortal();
}

export async function upsertSpeedRow(
  weekStart: string,
  sprint10m: number | null,
  sprint30m: number | null,
  illinoisRunSec: number | null
) {
  const db = getDb();
  const now = new Date();
  await db
    .insert(weeklySpeed)
    .values({ weekStart, sprint10m, sprint30m, illinoisRunSec, updatedAt: now })
    .onConflictDoUpdate({
      target: weeklySpeed.weekStart,
      set: { sprint10m, sprint30m, illinoisRunSec, updatedAt: now },
    });
  revalidatePortal();
}

export async function deleteSpeedRow(weekStart: string) {
  const db = getDb();
  await db.delete(weeklySpeed).where(eq(weeklySpeed.weekStart, weekStart));
  revalidatePortal();
}

export async function upsertScheduleCell(
  weekStart: string,
  weekday: number,
  hour: number,
  label: string
) {
  getDb();
  const now = Date.now();
  getRawSqlite()
    .prepare(
      `INSERT INTO schedule_slot (week_start, weekday, hour, label, updated_at)
       VALUES (@weekStart, @weekday, @hour, @label, @now)
       ON CONFLICT(week_start, weekday, hour) DO UPDATE SET
         label = excluded.label,
         updated_at = excluded.updated_at`
    )
    .run({ weekStart, weekday, hour, label, now });
  revalidatePortal();
}

export async function saveShortTermGoal(content: string) {
  const db = getDb();
  const now = new Date();
  await db
    .update(shortTermGoal)
    .set({ content, updatedAt: now })
    .where(eq(shortTermGoal.id, 1));
  revalidatePath("/");
}
