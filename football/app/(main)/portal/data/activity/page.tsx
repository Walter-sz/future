import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { weeklyActivity } from "@/lib/db/schema";
import { ActivityTable } from "@/components/data-tables/ActivityTable";

export const dynamic = "force-dynamic";

export default async function ActivityDataPage() {
  const db = getDb();
  const rows = await db.select().from(weeklyActivity).orderBy(desc(weeklyActivity.weekStart));

  const initialRows = rows.map((r) => ({
    weekStart: r.weekStart,
    trainingCount: r.trainingCount,
    matchCount: r.matchCount,
  }));

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-emerald-700 hover:underline">
        返回 Portal
      </Link>
      <h1 className="text-xl font-bold text-slate-900">训练 / 比赛次数 · 原始数据</h1>
      <ActivityTable initialRows={initialRows} />
    </div>
  );
}
