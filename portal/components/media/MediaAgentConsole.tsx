"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";

type RunSummary = {
  id: string;
  triggerSource: string;
  status: "queued" | "running" | "success" | "failed";
  dryRun: boolean;
  totalItems?: number;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
};

type RunEvent = {
  eventId: number;
  runId: string;
  level: "info" | "warn" | "error";
  node: string;
  message: string;
  payload?: unknown;
  createdAt: string;
};

type ReviewItem = {
  key: string;
  sourceName: string;
  sourcePath: string;
  sourceParentDir: string;
};

type RunDetailResp = {
  ok: boolean;
  run?: RunSummary;
  events?: RunEvent[];
  error?: string;
};
type ItemEventGroup = {
  itemKey: string;
  sourceName: string;
  sourcePath: string;
  events: RunEvent[];
};

const flowMermaid = `flowchart LR
  scanInbox[扫描待入库]
  normalizeTitle[名称规范化]
  fetchMeta[抓取元数据 TMDB]
  persistMeta[写入JSON与索引]
  updateRun[追加运行日志]
  scanInbox --> normalizeTitle --> fetchMeta --> persistMeta --> updateRun`;

export function MediaAgentConsole() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [logViewMode, setLogViewMode] = useState<"timeline" | "by-item">("timeline");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const loadRuns = useCallback(async () => {
    const r = await fetch("/api/agent/media/runs", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || "加载 runs 失败");
    const items = (data.items || []) as RunSummary[];
    setRuns(items);
    if (!selectedRunId && items[0]?.id) setSelectedRunId(items[0].id);
  }, [selectedRunId]);

  const loadRunDetail = useCallback(async (runId: string) => {
    const r = await fetch(`/api/agent/media/runs/${runId}`, { cache: "no-store" });
    const data = (await r.json()) as RunDetailResp;
    if (!r.ok || !data.ok || !data.run) throw new Error(data.error || "加载 run 详情失败");
    setEvents(data.events || []);
    setRuns((old) => old.map((x) => (x.id === data.run!.id ? data.run! : x)));
    return data.run;
  }, []);

  async function triggerRun(dryRun: boolean) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/agent/media/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, triggerSource: "portal-ui" }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok || !data.run) throw new Error(data.error || "触发失败");
      await loadRuns();
      setSelectedRunId(data.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRuns().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRunId) return;
    setSelectedItemKey(null);
    let timer: NodeJS.Timeout | null = null;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      try {
        const run = await loadRunDetail(selectedRunId);
        if (run.status === "running" || run.status === "queued") {
          timer = setTimeout(poll, 1500);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "轮询失败");
      }
    };
    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedRunId, loadRunDetail]);

  const selected = useMemo(
    () => runs.find((x) => x.id === selectedRunId) || null,
    [runs, selectedRunId]
  );
  const reviewItems = useMemo<ReviewItem[]>(() => {
    const map = new Map<string, ReviewItem>();
    for (const e of events) {
      const payload = (e.payload || {}) as Record<string, unknown>;
      if (payload.type === "needs-review") {
        const sourcePath = String(payload.sourcePath || "");
        if (!sourcePath) continue;
        map.set(sourcePath, {
          key: sourcePath,
          sourceName: String(payload.sourceName || ""),
          sourcePath,
          sourceParentDir: String(payload.sourceParentDir || ""),
        });
      }
      if (payload.type === "aggregate-split") {
        const dir = String(payload.dir || "");
        if (!dir) continue;
        map.set(`dir:${dir}`, {
          key: `dir:${dir}`,
          sourceName: `汇总目录：${String(payload.dirName || dir)}`,
          sourcePath: dir,
          sourceParentDir: dir,
        });
      }
      if (payload.type === "music-artist-unit") {
        const unitPath = String(payload.unitPath || "");
        if (!unitPath) continue;
        map.set(`music:${unitPath}`, {
          key: `music:${unitPath}`,
          sourceName: `音乐艺术家整体：${String(payload.unitName || unitPath)}`,
          sourcePath: unitPath,
          sourceParentDir: unitPath,
        });
      }
    }
    return Array.from(map.values());
  }, [events]);
  const itemGroups = useMemo<ItemEventGroup[]>(() => {
    const map = new Map<string, ItemEventGroup>();
    for (const e of events) {
      const payload = (e.payload || {}) as Record<string, unknown>;
      const itemKey = String(payload.itemKey || "");
      if (!itemKey) continue;
      const sourcePath = String(payload.sourcePath || itemKey);
      const sourceName = String(payload.sourceName || sourcePath.split("/").pop() || "未命名条目");
      const existing = map.get(itemKey);
      if (existing) {
        existing.events.push(e);
      } else {
        map.set(itemKey, {
          itemKey,
          sourceName,
          sourcePath,
          events: [e],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const ta = a.events[a.events.length - 1]?.createdAt || "";
      const tb = b.events[b.events.length - 1]?.createdAt || "";
      return tb.localeCompare(ta);
    });
  }, [events]);
  const selectedItemGroup = useMemo(
    () => itemGroups.find((x) => x.itemKey === selectedItemKey) || itemGroups[0] || null,
    [itemGroups, selectedItemKey]
  );

  useEffect(() => {
    if (!autoScrollLogs) return;
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, selectedRunId, autoScrollLogs, logViewMode, selectedItemKey]);
  useEffect(() => {
    if (logViewMode !== "by-item") return;
    if (!selectedItemKey && itemGroups[0]?.itemKey) {
      setSelectedItemKey(itemGroups[0].itemKey);
    }
  }, [logViewMode, itemGroups, selectedItemKey]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">影视资源 Agent 流程</h2>
        <p className="mb-3 text-sm text-slate-600">
          默认建议先 dry-run，确认日志与命名规则后再执行真实入库。所有运行记录会持久化保存。
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {flowMermaid}
        </pre>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => triggerRun(true)}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            扫描并执行（dry-run）
          </button>
          <button
            onClick={() => triggerRun(false)}
            disabled={loading}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            确认执行（会移动文件）
          </button>
          <button
            onClick={() => loadRuns().catch((err) => setError(err instanceof Error ? err.message : "刷新失败"))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          >
            刷新记录
          </button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[300px,1fr]">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">历史运行</h3>
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full rounded-lg border p-2 text-left text-xs ${
                      selectedRunId === run.id
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 bg-slate-50 hover:bg-white"
                    }`}
                  >
                    <div className="font-medium text-slate-800">{run.id.slice(0, 8)}</div>
                    <div className="mt-1 text-slate-500">
                      {run.dryRun ? "dry-run" : "execute"} · {run.status}
                    </div>
                    <div className="mt-1 text-slate-500">{new Date(run.startedAt).toLocaleString()}</div>
                  </button>
                </li>
              ))}
              {runs.length === 0 ? <li className="text-sm text-slate-500">暂无运行记录</li> : null}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">执行过程</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLogViewMode((m) => (m === "timeline" ? "by-item" : "timeline"))}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  {logViewMode === "timeline" ? "视图：时间线" : "视图：按条目"}
                </button>
                <button
                  onClick={() => setAutoScrollLogs((v) => !v)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  {autoScrollLogs ? "自动滚动：开" : "自动滚动：关"}
                </button>
              </div>
            </div>
            {selected ? (
              <p className="mb-2 text-xs text-slate-600">
                当前 run: {selected.id} · {selected.status} · {selected.dryRun ? "dry-run" : "execute"}
              </p>
            ) : null}
            {reviewItems.length > 0 ? (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-2 text-xs font-semibold text-amber-900">
                  需要人工复核（来自汇总目录拆分）
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-900">
                  {reviewItems.map((x) => (
                    <li key={x.key}>
                      <span className="font-medium">{x.sourceName || "未命名条目"}</span>
                      <div className="break-all text-[11px] text-amber-800">{x.sourcePath}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {logViewMode === "timeline" ? (
              <div
                ref={logContainerRef}
                className="max-h-[380px] overflow-y-auto rounded bg-slate-900 p-3 text-xs text-slate-100"
              >
                {events.length === 0 ? (
                  <p className="text-slate-400">暂无日志</p>
                ) : (
                  events.map((e) => (
                    <div key={`${e.runId}-${e.eventId}`} className="mb-1">
                      <span className="text-slate-400">{new Date(e.createdAt).toLocaleTimeString()}</span>{" "}
                      <span className="text-emerald-300">[{e.node}]</span> {e.message}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[260px,1fr]">
                <ul className="max-h-[380px] space-y-2 overflow-y-auto pr-1 text-xs">
                  {itemGroups.map((g) => (
                    <li key={g.itemKey}>
                      <button
                        onClick={() => setSelectedItemKey(g.itemKey)}
                        className={`w-full rounded border px-2 py-2 text-left ${
                          selectedItemGroup?.itemKey === g.itemKey
                            ? "border-amber-300 bg-amber-50 text-amber-900"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="line-clamp-1 font-medium">{g.sourceName}</div>
                        <div className="mt-1 text-[11px] opacity-80">{g.events.length} 条日志</div>
                      </button>
                    </li>
                  ))}
                  {itemGroups.length === 0 ? <li className="text-slate-500">暂无可分组日志</li> : null}
                </ul>
                <div
                  ref={logContainerRef}
                  className="max-h-[380px] overflow-y-auto rounded bg-slate-900 p-3 text-xs text-slate-100"
                >
                  {selectedItemGroup ? (
                    <>
                      <p className="mb-2 break-all text-[11px] text-slate-400">{selectedItemGroup.sourcePath}</p>
                      {selectedItemGroup.events.map((e) => (
                        <div key={`${e.runId}-${e.eventId}`} className="mb-1">
                          <span className="text-slate-400">{new Date(e.createdAt).toLocaleTimeString()}</span>{" "}
                          <span className="text-emerald-300">[{e.node}]</span> {e.message}
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-slate-400">暂无日志</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
