"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { chinaBoyP50SeriesForWeeks } from "@/lib/china-boy-p50-reference";
import { formatAgeZhForWeekMonday } from "@/lib/mike";
import type { ActivityPoint, AnthropometricPoint, SpeedPoint } from "@/lib/portal-data";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const LINE_CHART_HEIGHT_PX = 252;

type TooltipParam = {
  axisValue?: string;
  dataIndex?: number;
  seriesName?: string;
  value?: unknown;
  marker?: string;
};

function makeAxisTooltipFormatter(weekMondayList: string[], birthYmd: string) {
  return (params: TooltipParam | TooltipParam[]) => {
    const list = Array.isArray(params) ? params : [params];
    const first = list[0];
    const idx = first?.dataIndex ?? 0;
    const weekYmd = weekMondayList[idx];
    const axisShort = first?.axisValue ?? "";
    const header = weekYmd
      ? `<span style="font-weight:600">Mike ${formatAgeZhForWeekMonday(birthYmd, weekYmd)}</span><br/>周始 ${weekYmd}（${axisShort}）<br/><br/>`
      : "";
    const lines = list.map((p) => {
      const v = p.value;
      const valStr = v === null || v === undefined || v === "" ? "—" : String(v);
      return `${p.marker ?? ""} ${p.seriesName}：${valStr}`;
    });
    return header + lines.join("<br/>");
  };
}

function shortWeekLabel(ymd: string) {
  const [, m, d] = ymd.split("-");
  return `${m}/${d}`;
}

/** 单点或极窄范围时拉开 Y 轴，避免折线「看不见」 */
function padAxisExtent(min: number, max: number, padRatio = 0.12, singlePad = 3) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return {};
  if (min === max) {
    return { min: min - singlePad, max: max + singlePad };
  }
  const span = max - min;
  const p = Math.max(span * padRatio, 0.5);
  return { min: min - p, max: max + p };
}

function axisPaddingFromSeries(values: (number | null)[]) {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return {};
  return padAxisExtent(Math.min(...nums), Math.max(...nums));
}

export function ChartCards({
  birthYmd,
  anthropometric,
  speed,
  activity,
}: {
  birthYmd: string;
  anthropometric: AnthropometricPoint[];
  speed: SpeedPoint[];
  activity: ActivityPoint[];
}) {
  const weekMondayList = anthropometric.map((p) => p.week);
  const weekLabels = anthropometric.map((p) => shortWeekLabel(p.week));
  const chartKey = weekMondayList.join("|");
  const tipFmt = makeAxisTooltipFormatter(weekMondayList, birthYmd);

  const heights = anthropometric.map((p) => p.heightCm);
  const weights = anthropometric.map((p) => p.weightKg);
  const { heights: p50Heights, weights: p50Weights } = chinaBoyP50SeriesForWeeks(birthYmd, weekMondayList);
  const y0 = axisPaddingFromSeries([...heights, ...p50Heights]);
  const y1 = axisPaddingFromSeries([...weights, ...p50Weights]);

  /** 身高：黄色；体重：蓝色（实测与对应 P50 虚线同色） */
  const anthroHeightColor = "#eab308";
  const anthroWeightColor = "#2563eb";

  const p50LineBase = {
    smooth: true as const,
    showSymbol: false as const,
    connectNulls: true as const,
    emphasis: { disabled: true as const },
    lineStyle: { type: "dashed" as const, width: 1.5 },
    z: 1,
  };

  const anthropoOption = {
    tooltip: { trigger: "axis" as const, formatter: tipFmt },
    legend: {
      data: ["男童P50·身高", "男童P50·体重", "身高(cm)", "体重(kg)"],
      bottom: 0,
      type: "scroll" as const,
    },
    grid: { left: 48, right: 48, top: 36, bottom: 72 },
    xAxis: { type: "category" as const, data: weekLabels, axisLabel: { fontSize: 10 } },
    yAxis: [
      {
        type: "value" as const,
        name: "身高",
        nameTextStyle: { padding: [8, 0, 0, 0] },
        scale: true,
        ...y0,
      },
      {
        type: "value" as const,
        name: "体重",
        nameTextStyle: { padding: [8, 0, 0, 0] },
        scale: true,
        ...y1,
      },
    ],
    series: [
      {
        name: "男童P50·身高",
        type: "line" as const,
        yAxisIndex: 0,
        data: p50Heights,
        ...p50LineBase,
        itemStyle: { color: anthroHeightColor },
        lineStyle: { ...p50LineBase.lineStyle, color: anthroHeightColor },
      },
      {
        name: "男童P50·体重",
        type: "line" as const,
        yAxisIndex: 1,
        data: p50Weights,
        ...p50LineBase,
        itemStyle: { color: anthroWeightColor },
        lineStyle: { ...p50LineBase.lineStyle, color: anthroWeightColor },
      },
      {
        name: "身高(cm)",
        type: "line" as const,
        yAxisIndex: 0,
        data: heights,
        smooth: true,
        showSymbol: true,
        connectNulls: true,
        itemStyle: { color: anthroHeightColor },
        lineStyle: { color: anthroHeightColor },
        z: 2,
      },
      {
        name: "体重(kg)",
        type: "line" as const,
        yAxisIndex: 1,
        data: weights,
        smooth: true,
        showSymbol: true,
        connectNulls: true,
        itemStyle: { color: anthroWeightColor },
        lineStyle: { color: anthroWeightColor },
        z: 2,
      },
    ],
  };

  const speedOption = {
    tooltip: { trigger: "axis" as const, formatter: tipFmt },
    legend: { data: ["10m(s)", "30m(s)", "100m(s)"], bottom: 0 },
    grid: { left: 40, right: 24, top: 36, bottom: 56 },
    xAxis: { type: "category" as const, data: weekLabels, axisLabel: { fontSize: 10 } },
    yAxis: {
      type: "value" as const,
      name: "秒",
      nameTextStyle: { padding: [8, 0, 0, 0] },
      scale: true,
      ...padAxisFromTriple(speed),
    },
    series: [
      {
        name: "10m(s)",
        type: "line" as const,
        data: speed.map((p) => p.sprint10m),
        smooth: true,
        connectNulls: true,
      },
      {
        name: "30m(s)",
        type: "line" as const,
        data: speed.map((p) => p.sprint30m),
        smooth: true,
        connectNulls: true,
      },
      {
        name: "100m(s)",
        type: "line" as const,
        data: speed.map((p) => p.sprint100m),
        smooth: true,
        connectNulls: true,
      },
    ],
  };

  const activityOption = {
    tooltip: { trigger: "axis" as const, formatter: tipFmt },
    legend: { data: ["训练次数", "比赛次数"], bottom: 0 },
    grid: { left: 40, right: 24, top: 24, bottom: 56 },
    xAxis: { type: "category" as const, data: weekLabels, axisLabel: { fontSize: 10 } },
    yAxis: {
      type: "value" as const,
      minInterval: 1,
      ...padAxisFromActivity(activity),
    },
    series: [
      {
        name: "训练次数",
        type: "line" as const,
        data: activity.map((p) => p.training),
        smooth: true,
        connectNulls: true,
      },
      {
        name: "比赛次数",
        type: "line" as const,
        data: activity.map((p) => p.match),
        smooth: true,
        connectNulls: true,
      },
    ],
  };

  const cardShell =
    "flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md";

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className={cardShell}>
        <Link
          href="/portal/data/anthropometric"
          className="mb-1 block text-center text-sm font-medium text-slate-700 hover:text-emerald-700"
        >
          身高 / 体重（周）
        </Link>
        <div
          className="w-full"
          style={{ minHeight: LINE_CHART_HEIGHT_PX }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ReactECharts
            key={`anthro-${chartKey}`}
            option={anthropoOption}
            style={{ height: LINE_CHART_HEIGHT_PX, width: "100%" }}
            opts={{ renderer: "svg" }}
            notMerge
            lazyUpdate
          />
        </div>
        <Link href="/portal/data/anthropometric" className="mt-1 block text-center text-xs text-emerald-600 hover:underline">
          点击查看与编辑数据表
        </Link>
      </div>

      <div className={cardShell}>
        <Link
          href="/portal/data/speed"
          className="mb-1 block text-center text-sm font-medium text-slate-700 hover:text-emerald-700"
        >
          速度（周）
        </Link>
        <div className="w-full" style={{ minHeight: LINE_CHART_HEIGHT_PX }}>
          <ReactECharts
            key={`speed-${chartKey}`}
            option={speedOption}
            style={{ height: LINE_CHART_HEIGHT_PX, width: "100%" }}
            opts={{ renderer: "svg" }}
            notMerge
            lazyUpdate
          />
        </div>
        <Link href="/portal/data/speed" className="mt-1 block text-center text-xs text-emerald-600 hover:underline">
          点击查看与编辑数据表
        </Link>
      </div>

      <div className={cardShell}>
        <Link
          href="/portal/data/activity"
          className="mb-1 block text-center text-sm font-medium text-slate-700 hover:text-emerald-700"
        >
          训练 / 比赛次数（周）
        </Link>
        <div className="w-full" style={{ minHeight: LINE_CHART_HEIGHT_PX }}>
          <ReactECharts
            key={`act-${chartKey}`}
            option={activityOption}
            style={{ height: LINE_CHART_HEIGHT_PX, width: "100%" }}
            opts={{ renderer: "svg" }}
            notMerge
            lazyUpdate
          />
        </div>
        <Link href="/portal/data/activity" className="mt-1 block text-center text-xs text-emerald-600 hover:underline">
          点击查看与编辑数据表
        </Link>
      </div>
    </div>
  );
}

function padAxisFromTriple(speed: SpeedPoint[]) {
  const vals: number[] = [];
  for (const p of speed) {
    if (p.sprint10m != null) vals.push(p.sprint10m);
    if (p.sprint30m != null) vals.push(p.sprint30m);
    if (p.sprint100m != null) vals.push(p.sprint100m);
  }
  if (vals.length === 0) return {};
  return padAxisExtent(Math.min(...vals), Math.max(...vals), 0.15, 0.5);
}

function padAxisFromActivity(activity: ActivityPoint[]) {
  const vals: number[] = [];
  for (const p of activity) {
    if (p.training != null) vals.push(p.training);
    if (p.match != null) vals.push(p.match);
  }
  if (vals.length === 0) return {};
  return padAxisExtent(Math.min(...vals), Math.max(...vals), 0.1, 1);
}
