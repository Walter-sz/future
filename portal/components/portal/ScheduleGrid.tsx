"use client";

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { upsertScheduleCell } from "@/app/actions/data";
import { FOOTBALL_APP_BASE } from "@/lib/app-paths";
import {
  SCHEDULE_HOURS,
  WEEKDAY_LABELS,
  addDays,
  addWeeks,
  formatMonthDayCn,
  getWeekMonday,
} from "@/lib/week";

const COLUMN_WIDTHS_KEY = "mike-football-schedule-column-widths-v1";
/** 时间列 + 周一…周日 共 8 列 */
const DEFAULT_WIDTHS = [96, 104, 104, 104, 104, 104, 104, 104] as const;
const MIN_COL_W = 56;
const MAX_COL_W = 480;

type Props = {
  weekStart: string;
  initialCells: Record<string, string>;
};

function cellKey(weekday: number, hour: number) {
  return `${weekday}-${hour}`;
}

function clampWidth(n: number): number {
  return Math.min(MAX_COL_W, Math.max(MIN_COL_W, Math.round(n)));
}

function loadStoredWidths(): number[] {
  if (typeof window === "undefined") return [...DEFAULT_WIDTHS];
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (!raw) return [...DEFAULT_WIDTHS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 8) return [...DEFAULT_WIDTHS];
    return parsed.map((v, i) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return DEFAULT_WIDTHS[i];
      return clampWidth(n);
    });
  } catch {
    return [...DEFAULT_WIDTHS];
  }
}

function persistWidths(widths: number[]) {
  try {
    window.localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    /* ignore quota / private mode */
  }
}

export function ScheduleGrid({ weekStart, initialCells }: Props) {
  const [cells, setCells] = useState(initialCells);
  const [isPending, startTransition] = useTransition();
  const [columnWidths, setColumnWidths] = useState<number[]>(() => [...DEFAULT_WIDTHS]);
  const columnWidthsRef = useRef(columnWidths);

  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => {
    setColumnWidths(loadStoredWidths());
  }, []);

  useEffect(() => {
    setCells(initialCells);
  }, [weekStart, initialCells]);

  const save = useCallback(
    (weekday: number, hour: number, label: string) => {
      const key = cellKey(weekday, hour);
      setCells((c) => ({ ...c, [key]: label }));
      startTransition(async () => {
        await upsertScheduleCell(weekStart, weekday, hour, label);
      });
    },
    [weekStart]
  );

  const beginResize = useCallback((colIndex: number) => {
    return (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = columnWidthsRef.current[colIndex] ?? DEFAULT_WIDTHS[colIndex];

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const nw = clampWidth(startW + delta);
        setColumnWidths((prev) => {
          const next = [...prev];
          next[colIndex] = nw;
          columnWidthsRef.current = next;
          return next;
        });
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        persistWidths(columnWidthsRef.current);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }, []);

  const prevWeek = useMemo(() => addWeeks(weekStart, -1), [weekStart]);
  const nextWeek = useMemo(() => addWeeks(weekStart, 1), [weekStart]);
  const thisWeek = useMemo(() => getWeekMonday(), []);

  const dayColumns = useMemo(
    () =>
      WEEKDAY_LABELS.map((label, weekday) => {
        const ymd = addDays(weekStart, weekday);
        return { label, weekday, ymd, dateLabel: formatMonthDayCn(ymd) };
      }),
    [weekStart]
  );

  const tableWidth = useMemo(
    () => columnWidths.reduce((a, b) => a + b, 0),
    [columnWidths]
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-800">每周时间表</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">
            周始 {weekStart}
            {isPending ? <span className="ml-2 text-emerald-600">保存中…</span> : null}
          </span>
          <div className="flex gap-1">
            <Link
              href={`${FOOTBALL_APP_BASE}?week=${prevWeek}`}
              scroll={false}
              className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
            >
              上一周
            </Link>
            <Link
              href={`${FOOTBALL_APP_BASE}?week=${thisWeek}`}
              scroll={false}
              className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
            >
              本周
            </Link>
            <Link
              href={`${FOOTBALL_APP_BASE}?week=${nextWeek}`}
              scroll={false}
              className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
            >
              下一周
            </Link>
          </div>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        表头右侧边缘可拖动调节列宽，宽度会保存在本浏览器中。
      </p>
      <div className="overflow-x-auto">
        <table
          className="border-collapse text-sm"
          style={{ width: tableWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columnWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="relative border border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-600"
                style={{ width: columnWidths[0] }}
              >
                时间
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖动调整「时间」列宽"
                  className="absolute right-0 top-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize select-none hover:bg-emerald-500/25"
                  onMouseDown={beginResize(0)}
                />
              </th>
              {dayColumns.map(({ label, ymd, dateLabel }, i) => {
                const colIndex = i + 1;
                return (
                  <th
                    key={ymd}
                    className="relative border border-slate-200 bg-slate-50 px-1 py-2 text-center font-medium text-slate-600"
                    style={{ width: columnWidths[colIndex] }}
                  >
                    <div className="flex flex-col items-center gap-0.5 leading-tight">
                      <span>{label}</span>
                      <span className="text-xs font-normal text-slate-500">{dateLabel}</span>
                    </div>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`拖动调整「${label}」列宽`}
                      className="absolute right-0 top-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize select-none hover:bg-emerald-500/25"
                      onMouseDown={beginResize(colIndex)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SCHEDULE_HOURS.map((hour) => (
              <tr key={hour}>
                <td className="border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                  {hour}:00 – {hour + 1}:00
                </td>
                {dayColumns.map(({ weekday, ymd }) => (
                  <td key={cellKey(weekday, hour)} className="border border-slate-200 p-0 align-top">
                    <CellInput
                      value={cells[cellKey(weekday, hour)] ?? ""}
                      onCommit={(v) => save(weekday, hour, v)}
                      ariaDateLabel={ymd}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CellInput({
  value,
  onCommit,
  ariaDateLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  ariaDateLabel: string;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <textarea
      className="box-border min-h-[48px] w-full resize-y border-0 bg-transparent px-1 py-1 text-xs text-slate-800 outline-none focus:bg-emerald-50/50"
      rows={2}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local.trim())}
      aria-label={`${ariaDateLabel} 日程`}
    />
  );
}
