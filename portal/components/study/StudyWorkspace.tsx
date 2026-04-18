"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddStudyTabDialog } from "./AddStudyTabDialog";
import { StudyFolderPanel } from "./StudyFolderPanel";
import { StudyMindmapPanel } from "./StudyMindmapPanel";
import { StudyPinnedPanel } from "./StudyPinnedPanel";
import { isPinnedTab, parseStudyTabConfig } from "@/lib/study-types";
import type { StudyTabRow } from "@/lib/study-types";

export function StudyWorkspace() {
  const [tabs, setTabs] = useState<StudyTabRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [rename, setRename] = useState("");
  const dirtyRef = useRef<Record<number, boolean>>({});

  const loadTabs = useCallback(async (opts?: { activateTabId?: number | null }) => {
    const res = await fetch("/api/study/tabs");
    const j = (await res.json()) as { ok?: boolean; tabs?: StudyTabRow[] };
    if (!res.ok || !j.ok || !j.tabs) {
      setTabs([]);
      return;
    }
    setTabs(j.tabs);
    setActiveId((prev) => {
      const prefer = opts?.activateTabId;
      if (prefer != null && j.tabs!.some((t) => t.id === prefer)) {
        return prefer;
      }
      if (prev !== null && j.tabs!.some((t) => t.id === prev)) return prev;
      return j.tabs![0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void loadTabs().finally(() => setLoading(false));
  }, [loadTabs]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.values(dirtyRef.current).some(Boolean)) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? null;

  const setDirty = useCallback((id: number, dirty: boolean) => {
    dirtyRef.current = { ...dirtyRef.current, [id]: dirty };
  }, []);

  /** 每个脑图 Tab 固定引用，避免父组件重渲染时改变 onDirtyChange 导致 MindmapPanel 主 effect 反复 cleanup/PATCH */
  const mindmapDirtyByTabId = useMemo(() => {
    const m = new Map<number, (dirty: boolean) => void>();
    for (const t of tabs) {
      if (t.tabType !== "mindmap") continue;
      const id = t.id;
      m.set(id, (dirty: boolean) => setDirty(id, dirty));
    }
    return m;
  }, [tabs, setDirty]);

  const confirmCloseTab = (id: number) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab || isPinnedTab(tab.tabType)) return;

    // 脑图 Tab：不弹确认；服务端仅删库记录，不删 study/mindmaps 下 JSON 文件
    if (tab.tabType !== "mindmap") {
      const dirty = !!dirtyRef.current[id];
      const lines: string[] = [];
      if (dirty) {
        lines.push("该 Tab 有尚未写入磁盘的更改，删除将丢弃这些编辑。");
      }
      lines.push(`确定要删除 Tab「${tab.title}」吗？此操作不可恢复。`);
      if (tab.tabType === "folder") {
        const cfg = parseStudyTabConfig(tab.configJson);
        const p = typeof cfg.serverPath === "string" ? cfg.serverPath : "";
        lines.push("");
        lines.push("将仅从门户移除该文件夹入口，不会删除磁盘上目录及其中的文件。");
        if (p) lines.push(`当前绑定路径：${p}`);
      }
      if (!window.confirm(lines.join("\n"))) return;
    }

    void (async () => {
      const res = await fetch(`/api/study/tabs/${id}`, { method: "DELETE" });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        alert(j.error ?? "删除失败");
        return;
      }
      delete dirtyRef.current[id];
      await loadTabs();
    })();
  };

  const submitRename = async () => {
    if (!active || isPinnedTab(active.tabType)) return;
    const t = rename.trim();
    if (!t) return;
    const res = await fetch(`/api/study/tabs/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    const j = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !j.ok) {
      alert(j.error ?? "重命名失败");
      return;
    }
    await loadTabs();
  };

  useEffect(() => {
    if (active && !isPinnedTab(active.tabType)) {
      setRename(active.title);
    }
  }, [active]);

  if (loading) {
    return <p className="text-sm text-slate-500">加载中…</p>;
  }

  return (
    <div className="flex min-h-[560px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        {tabs.map((t) => (
          <div key={t.id} className="flex items-center gap-1">
            <button
              type="button"
              className={`rounded-t px-3 py-1.5 text-sm ${
                t.id === activeId
                  ? "bg-amber-100 font-medium text-amber-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              onClick={() => setActiveId(t.id)}
            >
              {t.title}
            </button>
            {!isPinnedTab(t.tabType) ? (
              <button
                type="button"
                className="rounded px-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="删除此 Tab"
                onClick={() => confirmCloseTab(t.id)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="rounded border border-dashed border-slate-300 px-2 py-1 text-sm text-slate-600 hover:border-amber-400 hover:text-amber-800"
          onClick={() => setAddOpen(true)}
        >
          ＋ 添加 Tab
        </button>
      </div>

      {active ? (
        <div className="flex flex-col gap-3">
          {!isPinnedTab(active.tabType) ? (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">重命名</span>
                <input
                  className="rounded border border-slate-200 px-2 py-1"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded bg-slate-200 px-3 py-1 hover:bg-slate-300"
                  onClick={() => void submitRename()}
                >
                  保存名称
                </button>
              </div>
              {active.tabType === "mindmap" && active.mindmapStorage ? (
                <p className="max-w-full break-all text-xs text-slate-500">
                  脑图数据文件（Tab 标题与 .json 主文件名一致；vault 为「名称__TabId」）：{" "}
                  <span className="font-mono text-slate-600">{active.mindmapStorage.absolutePath}</span>
                </p>
              ) : null}
              {active.tabType === "folder" ? (
                <p className="max-w-full break-all text-xs text-slate-500">
                  绑定目录（服务端）：{" "}
                  <span className="font-mono text-slate-600">
                    {String(parseStudyTabConfig(active.configJson).serverPath ?? "—")}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}

          {active.tabType === "pinned_default" ? <StudyPinnedPanel /> : null}

          {tabs
            .filter((t) => t.tabType === "mindmap")
            .map((t) => (
              <div
                key={t.id}
                className={
                  t.id === activeId
                    ? "relative z-0 min-h-[480px] w-full"
                    : "pointer-events-none fixed left-[-9999px] top-0 z-0 h-[600px] w-[min(100vw,80rem)] max-w-7xl opacity-0"
                }
                aria-hidden={t.id !== activeId}
              >
                <StudyMindmapPanel
                  tabId={t.id}
                  isActive={t.id === activeId}
                  onDirtyChange={mindmapDirtyByTabId.get(t.id)!}
                />
              </div>
            ))}

          {active.tabType === "folder" ? (
            <StudyFolderPanel
              tabId={active.id}
              configJson={active.configJson}
              onDirtyChange={(d) => setDirty(active.id, d)}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">无 Tab</p>
      )}

      <AddStudyTabDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(newId) => void loadTabs({ activateTabId: newId })}
      />
    </div>
  );
}
