"use client";

import { useState } from "react";
import Link from "next/link";
import { FOOTBALL_APP_BASE } from "@/lib/app-paths";
import { AnthropometricTable } from "@/components/data-tables/AnthropometricTable";
import type { AnthropometricRow } from "@/components/data-tables/AnthropometricTable";

const tabs = [
  { id: "data" as const, label: "原始数据" },
  { id: "reference" as const, label: "身高体重对照表" },
];

export function AnthropometricDataTabs({
  initialRows,
  referenceImageNames,
}: {
  initialRows: AnthropometricRow[];
  referenceImageNames: string[];
}) {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("data");

  return (
    <div className="space-y-4">
      <Link href={FOOTBALL_APP_BASE} className="text-sm text-emerald-700 hover:underline">
        返回 Portal
      </Link>

      <h1 className="text-xl font-bold text-slate-900">身高 / 体重</h1>

      <div
        role="tablist"
        aria-label="身高体重页面分区"
        className="flex flex-wrap gap-1 border-b border-slate-200"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            id={`tab-${t.id}`}
            aria-controls={`panel-${t.id}`}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              active === t.id
                ? "border border-b-0 border-slate-200 bg-white text-emerald-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="panel-data"
        aria-labelledby="tab-data"
        hidden={active !== "data"}
        className="min-h-[200px]"
      >
        <AnthropometricTable initialRows={initialRows} />
      </div>

      <div
        role="tabpanel"
        id="panel-reference"
        aria-labelledby="tab-reference"
        hidden={active !== "reference"}
        className="min-h-[200px]"
      >
        <ReferenceImagesPanel imageNames={referenceImageNames} />
      </div>
    </div>
  );
}

function ReferenceImagesPanel({ imageNames }: { imageNames: string[] }) {
  if (imageNames.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
        <p className="mb-2">当前 <code className="rounded bg-white px-1">images</code> 目录下没有可展示的图片。</p>
        <p>
          请将身高体重对照表（PNG / JPG / WebP / GIF）放入项目{" "}
          <code className="rounded bg-white px-1">walter_data/images/</code> 目录后刷新本页。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">
        以下为 <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">images</code>{" "}
        目录中的对照表图片。宽度不超过页面时会自动缩小以适配；特宽时可横向滚动。
      </p>
      {imageNames.map((name) => (
        <figure key={name} className="space-y-2">
          <figcaption className="text-xs font-medium text-slate-500">{name}</figcaption>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/ref-image/${encodeURIComponent(name)}`}
              alt={`身高体重对照表：${name}`}
              className="mx-auto block h-auto max-w-full min-w-0"
              loading="lazy"
              decoding="async"
            />
          </div>
        </figure>
      ))}
    </div>
  );
}
