"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import type { MediaGenreSlice, MediaLibraryDashboardStats } from "@/lib/media-stats";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const CHART_HEIGHT = 280;

const axisText = "#64748b";
const splitLine = "rgba(148, 163, 184, 0.25)";
const amber = "#d97706";
const amberLight = "#fbbf24";
const slate = "#475569";

function baseGrid(): EChartsOption["grid"] {
  return { left: 48, right: 16, top: 36, bottom: 28, containLabel: true };
}

function yearLineOption(rows: MediaLibraryDashboardStats["yearDistribution"]): EChartsOption {
  const years = rows.map((r) => String(r.year));
  return {
    color: [amber, slate],
    title: { text: "拍摄年份分布", left: "center", top: 4, textStyle: { color: "#334155", fontSize: 13, fontWeight: 600 } },
    textStyle: { color: axisText, fontSize: 11 },
    tooltip: { trigger: "axis" },
    legend: { data: ["电影", "电视剧"], textStyle: { color: axisText, fontSize: 11 }, top: 28 },
    grid: { ...baseGrid(), top: 52 },
    xAxis: { type: "category", data: years, axisLabel: { color: axisText } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: splitLine } }, axisLabel: { color: axisText } },
    series: [
      { name: "电影", type: "line", smooth: true, data: rows.map((r) => r.movieCount) },
      { name: "电视剧", type: "line", smooth: true, data: rows.map((r) => r.tvCount) },
    ],
  };
}

const PIE_COLORS = [
  amber,
  amberLight,
  slate,
  "#94a3b8",
  "#cbd5e1",
  "#78716c",
  "#a8a29e",
  "#fcd34a",
  "#b45309",
  "#0369a1",
  "#0d9488",
  "#7c3aed",
  "#be185d",
  "#b91c1c",
  "#15803d",
  "#a16207",
  "#57534e",
];

function collectionPieOption(
  title: string,
  data: MediaGenreSlice[],
  options?: {
    subtext?: string;
    emptyHint?: string;
    legendTop?: number;
    gridTitleTop?: number;
    tooltipExtraLine?: string;
  }
): EChartsOption {
  const nonZero = data.filter((d) => d.value > 0);
  const hasData = nonZero.length > 0;
  const pieData = hasData ? nonZero.map((d) => ({ name: d.name, value: d.value })) : [{ name: "暂无数据", value: 1 }];
  const legendTop = options?.legendTop ?? (options?.subtext ? 44 : 36);
  const titleTop = options?.gridTitleTop ?? 4;

  return {
    color: PIE_COLORS,
    title: {
      text: title,
      ...(options?.subtext ? { subtext: options.subtext } : {}),
      left: "center",
      top: titleTop,
      textStyle: { color: "#334155", fontSize: 13, fontWeight: 600 },
      ...(options?.subtext
        ? { subtextStyle: { color: "#64748b", fontSize: 9, lineHeight: 13 } as const }
        : {}),
    },
    textStyle: { color: axisText, fontSize: 11 },
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        if (!hasData) return options?.emptyHint ?? "暂无数据";
        const p = params as { name?: string; value?: number; percent?: number };
        const base = `${p.name ?? ""}<br/>${p.value ?? 0} 部（${p.percent ?? 0}%）`;
        const extra = options?.tooltipExtraLine
          ? `<br/><span style="color:#94a3b8;font-size:11px">${options.tooltipExtraLine}</span>`
          : "";
        return base + extra;
      },
    },
    legend: { type: "scroll", orient: "vertical", right: 4, top: legendTop, bottom: 8, textStyle: { color: axisText, fontSize: 10 } },
    series: [
      {
        type: "pie",
        radius: ["34%", "58%"],
        center: ["40%", "56%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#fffbeb", borderWidth: 1 },
        label: {
          color: "#334155",
          fontSize: 9,
          formatter: (p) => {
            if (!hasData) return "暂无";
            const x = p as { name?: string; value?: number };
            return `${x.name ?? ""}\n${x.value ?? 0}`;
          },
        },
        data: pieData,
      },
    ],
  };
}

function intAxisLabel(value: number | string): string {
  return String(Math.round(Number(value)));
}

function monthlyWatchOption(monthly: MediaLibraryDashboardStats["monthlyWatch"]): EChartsOption {
  const { months, currentUnwatchedTotal } = monthly;
  const shortLabels = months.map((m) => m.monthShortLabel);
  const watchedAdded = months.map((m) => m.watchedAddedCount);
  const watchedCumulative = months.map((m) => m.watchedCumulativeCount);
  const unwatchedInt = Math.round(Number(currentUnwatchedTotal));
  const lineData = months.map(() => unwatchedInt);
  const cumulativeMax = watchedCumulative.length > 0 ? watchedCumulative[watchedCumulative.length - 1] : 0;
  const y1Max = Math.max(Math.ceil(Math.max(unwatchedInt, cumulativeMax) * 1.08), 1);
  const cumulativeColor = "#0d9488";

  return {
    color: [amber, cumulativeColor, slate],
    textStyle: { color: axisText, fontSize: 11 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number; axisValue?: string };
        const idx = first?.dataIndex ?? 0;
        const m = months[idx];
        const header = m
          ? `<div style="font-weight:600;margin-bottom:6px">${m.monthYm}</div>`
          : "";
        const bar = list.find((p: { seriesName?: string }) => p.seriesName === "当月已看") as
          | { marker?: string; value?: number }
          | undefined;
        const cum = list.find((p: { seriesName?: string }) => p.seriesName === "累积已看") as
          | { marker?: string; value?: number }
          | undefined;
        const line = list.find((p: { seriesName?: string }) => p.seriesName === "当前未看总数（参考线）") as
          | { marker?: string; value?: number }
          | undefined;
        const barLine =
          bar != null
            ? `${bar.marker ?? ""} 当月已看：<b>${Math.round(Number(bar.value ?? 0))}</b> 部<br/><span style="color:#94a3b8;font-size:11px">该月标记为已看的作品数</span>`
            : "";
        const cumLine =
          cum != null
            ? `<br/>${cum.marker ?? ""} 累积已看：<b>${Math.round(Number(cum.value ?? 0))}</b> 部<br/><span style="color:#94a3b8;font-size:11px">截至该月末累计标记为已看的作品数（电影+剧集）</span>`
            : "";
        const refLine =
          line != null
            ? `<br/>${line.marker ?? ""} 当前未看总数（参考线）：<b>${Math.round(Number(line.value ?? unwatchedInt))}</b> 部<br/><span style="color:#94a3b8;font-size:11px">全库当前未看总部数，非「该月未看」</span>`
            : "";
        return header + barLine + cumLine + refLine;
      },
    },
    legend: {
      data: ["当月已看", "累积已看", "当前未看总数（参考线）"],
      textStyle: { color: axisText, fontSize: 10 },
      top: 0,
    },
    grid: { ...baseGrid(), right: 52 },
    xAxis: { type: "category", data: shortLabels, axisLabel: { color: axisText, interval: "auto", rotate: 45 } },
    yAxis: [
      {
        type: "value",
        name: "当月已看",
        min: 0,
        minInterval: 1,
        splitLine: { lineStyle: { color: splitLine } },
        axisLabel: { color: axisText, formatter: intAxisLabel },
      },
      {
        type: "value",
        name: "累积 / 未看参考",
        min: 0,
        max: y1Max,
        minInterval: 1,
        splitLine: { show: false },
        axisLabel: { color: axisText, formatter: intAxisLabel },
      },
    ],
    series: [
      {
        name: "当月已看",
        type: "bar",
        data: watchedAdded,
        yAxisIndex: 0,
        itemStyle: { color: amber },
      },
      {
        name: "累积已看",
        type: "line",
        data: watchedCumulative,
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: cumulativeColor },
        itemStyle: { color: cumulativeColor },
      },
      {
        name: "当前未看总数（参考线）",
        type: "line",
        data: lineData,
        yAxisIndex: 1,
        showSymbol: false,
        lineStyle: { type: "dashed", width: 2, color: slate },
        emphasis: { disabled: true },
      },
    ],
  };
}

const chartShellClass =
  "rounded-xl border border-amber-200/70 bg-gradient-to-b from-amber-50/90 to-white p-3 shadow-sm";

export function MediaLibraryStatsCharts({ stats }: { stats: MediaLibraryDashboardStats }) {
  const { yearDistribution, movieCollectionDistribution, tvCollectionDistribution, monthlyWatch } = stats;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={chartShellClass} style={{ minHeight: CHART_HEIGHT }}>
          <ReactECharts
            option={yearLineOption(yearDistribution)}
            style={{ height: CHART_HEIGHT, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
        <div className={chartShellClass} style={{ minHeight: CHART_HEIGHT }}>
          <ReactECharts option={monthlyWatchOption(monthlyWatch)} style={{ height: CHART_HEIGHT, width: "100%" }} notMerge lazyUpdate />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={chartShellClass} style={{ minHeight: CHART_HEIGHT }}>
          <ReactECharts
            option={collectionPieOption("电影 · 合集分布", movieCollectionDistribution, {
              subtext: "人数与下方各电影类合集卡片一致",
              emptyHint: "暂无索引内的电影数据",
              legendTop: 48,
              gridTitleTop: 2,
            })}
            style={{ height: CHART_HEIGHT, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
        <div className={chartShellClass} style={{ minHeight: CHART_HEIGHT }}>
          <ReactECharts
          option={collectionPieOption("电视剧 · 合集分布", tvCollectionDistribution, {
            subtext: "与下方各剧集合集卡片同口径；合拍/多产地可计入多个国家，占比为相对各合集计数",
            emptyHint: "暂无索引内的电视剧数据",
            legendTop: 52,
            gridTitleTop: 2,
            tooltipExtraLine:
              "合拍剧（如美加）可同时出现在多个产地合集；饼图百分比为各合集人数之间的相对占比，不必等于 100% 剧集总部数。",
          })}
            style={{ height: CHART_HEIGHT, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
      </div>
    </div>
  );
}
