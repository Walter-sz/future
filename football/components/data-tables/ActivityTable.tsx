"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
} from "@tanstack/react-table";
import { useMemo } from "react";
import type { ActivityPoint } from "@/lib/portal-data";

const columnHelper = createColumnHelper<ActivityPoint>();

export function ActivityTable({ rows }: { rows: ActivityPoint[] }) {
  const columns = useMemo(
    () => [
      columnHelper.accessor("week", {
        header: "周起始（周一）",
        cell: (info) => <code className="text-xs text-slate-700">{info.getValue()}</code>,
      }),
      columnHelper.accessor("training", {
        header: "训练次数",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("match", {
        header: "比赛场次",
        cell: (info) => info.getValue(),
      }),
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
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
  );
}
