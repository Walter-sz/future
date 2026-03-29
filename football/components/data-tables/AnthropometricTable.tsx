"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
} from "@tanstack/react-table";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAnthropometricRow, upsertAnthropometricRow } from "@/app/actions/data";
import { normalizeToWeekMonday } from "@/lib/week";

export type AnthropometricRow = {
  weekStart: string;
  heightCm: number | null;
  weightKg: number | null;
};

const columnHelper = createColumnHelper<AnthropometricRow>();

export function AnthropometricTable({ initialRows }: { initialRows: AnthropometricRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ weekStart: "", heightCm: "", weightKg: "" });
  const [pick, setPick] = useState("");

  const columns = useMemo(
    () => [
      columnHelper.accessor("weekStart", {
        header: "周起始（周一）",
        cell: (info) => (
          <code className="text-xs text-slate-700">{info.getValue()}</code>
        ),
      }),
      columnHelper.accessor("heightCm", {
        header: "身高 (cm)",
        cell: (info) => (info.getValue() != null ? info.getValue() : "—"),
      }),
      columnHelper.accessor("weightKg", {
        header: "体重 (kg)",
        cell: (info) => (info.getValue() != null ? info.getValue() : "—"),
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
                await deleteAnthropometricRow(row.original.weekStart);
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
        heightCm: row.heightCm != null ? String(row.heightCm) : "",
        weightKg: row.weightKg != null ? String(row.weightKg) : "",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[480px] border-collapse text-sm">
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
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            周起始 YYYY-MM-DD（自动对齐到当周周一）
            <input
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.weekStart}
              onChange={(e) => setDraft((d) => ({ ...d, weekStart: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            身高 (cm)
            <input
              type="number"
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.heightCm}
              onChange={(e) => setDraft((d) => ({ ...d, heightCm: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            体重 (kg)
            <input
              type="number"
              className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
              value={draft.weightKg}
              onChange={(e) => setDraft((d) => ({ ...d, weightKg: e.target.value }))}
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
            const h = draft.heightCm.trim();
            const w = draft.weightKg.trim();
            startTransition(async () => {
              await upsertAnthropometricRow(ws, h === "" ? null : Number(h), w === "" ? null : Number(w));
              setDraft({ weekStart: "", heightCm: "", weightKg: "" });
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
