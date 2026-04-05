"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
} from "@tanstack/react-table";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSpeedRow, upsertSpeedRow } from "@/app/actions/data";
import { normalizeToWeekMonday } from "@/lib/week";

export type SpeedRow = {
  weekStart: string;
  sprint10m: number | null;
  sprint30m: number | null;
  illinoisRunSec: number | null;
};

const columnHelper = createColumnHelper<SpeedRow>();

function numCell(v: number | null) {
  return v != null ? v : "—";
}

export function SpeedTable({ initialRows }: { initialRows: SpeedRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    weekStart: "",
    sprint10m: "",
    sprint30m: "",
    illinoisRunSec: "",
  });
  const [pick, setPick] = useState("");

  const columns = useMemo(
    () => [
      columnHelper.accessor("weekStart", {
        header: "周起始（周一）",
        cell: (info) => <code className="text-xs text-slate-700">{info.getValue()}</code>,
      }),
      columnHelper.accessor("sprint10m", {
        header: "10m (秒)",
        cell: (info) => numCell(info.getValue()),
      }),
      columnHelper.accessor("sprint30m", {
        header: "30m (秒)",
        cell: (info) => numCell(info.getValue()),
      }),
      columnHelper.accessor("illinoisRunSec", {
        header: "伊利诺斯跑 (秒)",
        cell: (info) => numCell(info.getValue()),
      }),
      columnHelper.display({
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <button
            type="button"
            className="text-sm text-red-600 hover:underline"
            disabled={pending}
            onClick={() => {
              if (!confirm(`删除 ${row.original.weekStart} 的记录？`)) return;
              startTransition(async () => {
                await deleteSpeedRow(row.original.weekStart);
                router.refresh();
              });
            }}
          >
            删除
          </button>
        ),
      }),
    ],
    [pending, router]
  );

  const table = useReactTable({
    data: initialRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  function applyPick(weekStart: string) {
    setPick(weekStart);
    const row = initialRows.find((r) => r.weekStart === weekStart);
    if (row) {
      setDraft({
        weekStart: row.weekStart,
        sprint10m: row.sprint10m != null ? String(row.sprint10m) : "",
        sprint30m: row.sprint30m != null ? String(row.sprint30m) : "",
        illinoisRunSec: row.illinoisRunSec != null ? String(row.illinoisRunSec) : "",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border-b border-slate-200 px-3 py-2 text-left font-medium">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/80">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="border-b border-slate-100 px-3 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">编辑或新增（按周合并）</h2>
        <p className="mb-3 text-xs text-slate-500">速度以完成时间（秒）记录，数值越小越快。</p>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="text-slate-600">填入已有周：</label>
          <select
            className="rounded border border-slate-200 px-2 py-1"
            value={pick}
            onChange={(e) => applyPick(e.target.value)}
          >
            <option value="">选择…</option>
            {initialRows.map((r) => (
              <option key={r.weekStart} value={r.weekStart}>
                {r.weekStart}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            周起始 YYYY-MM-DD
            <input
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.weekStart}
              onChange={(e) => setDraft((d) => ({ ...d, weekStart: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            10m (秒)
            <input
              type="number"
              step="0.01"
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.sprint10m}
              onChange={(e) => setDraft((d) => ({ ...d, sprint10m: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            30m (秒)
            <input
              type="number"
              step="0.01"
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.sprint30m}
              onChange={(e) => setDraft((d) => ({ ...d, sprint30m: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            伊利诺斯跑 (秒)
            <input
              type="number"
              step="0.01"
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.illinoisRunSec}
              onChange={(e) => setDraft((d) => ({ ...d, illinoisRunSec: e.target.value }))}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={pending}
          className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          onClick={() => {
            const week = draft.weekStart.trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
              alert("请填写正确日期 YYYY-MM-DD");
              return;
            }
            const ws = normalizeToWeekMonday(week);
            const n = (s: string) => (s.trim() === "" ? null : Number(s));
            startTransition(async () => {
              await upsertSpeedRow(ws, n(draft.sprint10m), n(draft.sprint30m), n(draft.illinoisRunSec));
              setDraft({ weekStart: "", sprint10m: "", sprint30m: "", illinoisRunSec: "" });
              setPick("");
              router.refresh();
            });
          }}
        >
          {pending ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
