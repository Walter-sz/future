import Link from "next/link";
import { ActivityTable } from "@/components/data-tables/ActivityTable";
import { getPortalChartData } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

export default async function ActivityDataPage() {
  const { activity } = await getPortalChartData();

  return (
    <div className="space-y-4">
      <Link href="/football" className="text-sm text-emerald-700 hover:underline">
        返回 Portal
      </Link>
      <h1 className="text-xl font-bold text-slate-900">训练次数 / 比赛场次（按日程自动统计）</h1>
      <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4 text-sm leading-relaxed text-slate-700">
        <p className="mb-2">
          下列数字与 Portal 首页「训练 / 比赛次数」折线图一致，均由对应周的
          <strong className="font-medium text-slate-800">「每周时间表」</strong>
          格子内容自动汇总，无需在此手工填写。
        </p>
        <ul className="list-inside list-disc space-y-1 text-slate-600">
          <li>
            <strong className="font-medium text-slate-800">训练次数</strong>：统计文案中含「训练」的日程；同一星期、时间段连续相邻、且文案完全相同的多格视为
            <strong className="font-medium text-slate-800">同一节课</strong>，计 1 次。
          </li>
          <li>
            <strong className="font-medium text-slate-800">比赛场次</strong>：统计文案中含「比赛」的日程；同一星期、时间段连续相邻、且文案完全相同的多格视为
            <strong className="font-medium text-slate-800">同一场比赛</strong>，计 1 场。
          </li>
        </ul>
        <p className="mt-2 text-slate-500">修改日程请在 Portal 首页下方时间表中编辑并失焦保存。</p>
      </div>
      <ActivityTable rows={activity} />
    </div>
  );
}
