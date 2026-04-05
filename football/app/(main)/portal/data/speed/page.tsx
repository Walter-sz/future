import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { weeklySpeed } from "@/lib/db/schema";
import { SpeedTable } from "@/components/data-tables/SpeedTable";

export const dynamic = "force-dynamic";

export default async function SpeedDataPage() {
  const db = getDb();
  const rows = await db.select().from(weeklySpeed).orderBy(desc(weeklySpeed.weekStart));

  const initialRows = rows.map((r) => ({
    weekStart: r.weekStart,
    sprint10m: r.sprint10m,
    sprint30m: r.sprint30m,
    illinoisRunSec: r.illinoisRunSec,
  }));

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-emerald-700 hover:underline">
        返回 Portal
      </Link>
      <h1 className="text-xl font-bold text-slate-900">速度 · 原始数据</h1>
      <SpeedTable initialRows={initialRows} />
    </div>
  );
}
