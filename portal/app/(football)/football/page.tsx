import { ChartCards } from "@/components/portal/ChartCards";
import { ScheduleGrid } from "@/components/portal/ScheduleGrid";
import { ShortTermGoalForm } from "@/components/portal/ShortTermGoalForm";
import { MIKE_BIRTH_YMD, mikeAgeSummaryTodayLine } from "@/lib/mike";
import { getPortalChartData, getScheduleForWeek, getShortTermGoalContent } from "@/lib/portal-data";
import { getWeekMonday, normalizeToWeekMonday } from "@/lib/week";

export const dynamic = "force-dynamic";

type SearchParams = { week?: string | string[] };

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.week === "string" ? sp.week : undefined;
  const weekStart = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? normalizeToWeekMonday(raw) : getWeekMonday();

  const [chartData, scheduleMap, goalContent] = await Promise.all([
    getPortalChartData(),
    getScheduleForWeek(weekStart),
    getShortTermGoalContent(),
  ]);
  const { anthropometric, speed, activity } = chartData;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="mb-2 text-xl font-bold text-slate-900">Portal</h1>
        <p className="mb-4 text-sm leading-relaxed text-slate-600">
          Mike · {mikeAgeSummaryTodayLine()}。折线图悬停某一周时，会显示该周（以周一为周始）对应的年龄。
        </p>
        <ChartCards
          birthYmd={MIKE_BIRTH_YMD}
          anthropometric={anthropometric}
          speed={speed}
          activity={activity}
        />
      </div>
      <ScheduleGrid key={weekStart} weekStart={weekStart} initialCells={scheduleMap} />
      <ShortTermGoalForm initialContent={goalContent} />
    </div>
  );
}
