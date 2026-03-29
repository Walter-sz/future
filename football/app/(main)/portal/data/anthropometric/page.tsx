import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { weeklyAnthropometric } from "@/lib/db/schema";
import { listReferenceImages } from "@/lib/reference-images";
import { AnthropometricDataTabs } from "@/components/anthropometric/AnthropometricDataTabs";

export const dynamic = "force-dynamic";

export default async function AnthropometricDataPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(weeklyAnthropometric)
    .orderBy(desc(weeklyAnthropometric.weekStart));

  const initialRows = rows.map((r) => ({
    weekStart: r.weekStart,
    heightCm: r.heightCm,
    weightKg: r.weightKg,
  }));

  const referenceImageNames = listReferenceImages();

  return (
    <AnthropometricDataTabs initialRows={initialRows} referenceImageNames={referenceImageNames} />
  );
}
