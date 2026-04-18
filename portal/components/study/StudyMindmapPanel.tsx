"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  findAncestorIdPath,
  type MindMapSearchHit,
  searchMindMapNodesPreorder,
} from "@/lib/study-mindmap-search";
import "@/styles/mind-elixir.css";

type Props = {
  tabId: number;
  /** 当前是否为选中 Tab；非选中时仍挂载（离屏）以保留画布缩放/平移 */
  isActive: boolean;
  /** 保存失败时为 true，用于离开页提示；成功保存后为 false */
  onDirtyChange: (dirty: boolean) => void;
};

/** Mind Elixir 实例（避免与 bundler 类型细节强耦合） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MindLike = any;

/**
 * expandNode 内部会写 parent.children[1].expanded（折叠钮 me-epd）。
 * 根节点 topic 在 me-root 下，没有 me-epd；无子节点的分支也没有 me-epd，调用会崩。
 */
function safeExpandCollapsedTopic(mind: MindLike, tpc: HTMLElement): void {
  const parent = tpc.parentElement;
  if (!parent) return;
  const epd = parent.children[1] as HTMLElement | undefined;
  if (!epd || epd.tagName !== "ME-EPD") return;
  const n = (tpc as { nodeObj?: { expanded?: boolean } }).nodeObj;
  if (n && n.expanded === false) mind.expandNode(tpc, true);
}

/** 搜索用：勿调 focusNode（会进入「聚焦子树」模式）；清空搜索时再退出该模式并取消选中 */
function resetSearchCanvasState(mind: MindLike | null): void {
  if (!mind) return;
  try {
    if (mind.isFocusMode) mind.cancelFocus?.();
    mind.clearSelection?.();
  } catch {
    /* ignore */
  }
}

export function StudyMindmapPanel({ tabId, isActive, onDirtyChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindRef = useRef<MindLike | null>(null);
  /** 串行化保存，避免并发 PATCH 乱序 */
  const saveTailRef = useRef<Promise<void>>(Promise.resolve());
  const rafSaveRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<MindMapSearchHit[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchHitsRef = useRef<MindMapSearchHit[]>([]);
  searchHitsRef.current = searchHits;

  const focusNodeById = useCallback((mind: MindLike, hitId: string) => {
    try {
      const data = mind.getData();
      const root = data?.nodeData as unknown;
      const path = findAncestorIdPath(root, hitId);
      if (!path?.length) return;
      const passes = Math.max(1, path.length);
      for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < path.length - 1; i++) {
          let tpc: HTMLElement | undefined;
          try {
            tpc = mind.findEle(path[i]) as HTMLElement;
          } catch {
            continue;
          }
          safeExpandCollapsedTopic(mind, tpc);
        }
      }
      let target: HTMLElement | undefined;
      try {
        target = mind.findEle(hitId) as HTMLElement;
      } catch {
        return;
      }
      mind.selectNode(target);
      mind.scrollIntoView?.(target);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const focusSearchHit = useCallback(
    (hitId: string) => {
      const mind = mindRef.current;
      if (!mind) return;
      focusNodeById(mind, hitId);
    },
    [focusNodeById]
  );

  const flushSave = useCallback(async () => {
    const mind = mindRef.current;
    if (!mind) return;
    try {
      const data = mind.getData();
      const res = await fetch(`/api/study/tabs/${tabId}/mindmap`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (res.status === 404) {
        onDirtyChange(false);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      onDirtyChange(false);
    } catch (e) {
      console.error(e);
      onDirtyChange(true);
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }, [tabId, onDirtyChange]);

  const enqueueSave = useCallback(() => {
    saveTailRef.current = saveTailRef.current.then(() => flushSave());
  }, [flushSave]);

  const enqueueSaveOnFrame = useCallback(() => {
    if (rafSaveRef.current != null) return;
    rafSaveRef.current = requestAnimationFrame(() => {
      rafSaveRef.current = null;
      enqueueSave();
    });
  }, [enqueueSave]);

  useEffect(() => {
    setSearchQuery("");
    setSearchHits([]);
    setSearchIndex(0);
    resetSearchCanvasState(mindRef.current);
  }, [tabId]);

  /** 输入防抖：更新匹配列表（不自动跳转，避免输入时画布乱跳） */
  useEffect(() => {
    if (loading || error) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits([]);
      setSearchIndex(0);
      resetSearchCanvasState(mindRef.current);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      const mind = mindRef.current;
      if (!mind) return;
      try {
        const data = mind.getData();
        const hits = searchMindMapNodesPreorder(data?.nodeData, q);
        setSearchHits(hits);
        setSearchIndex(0);
      } catch {
        setSearchHits([]);
        setSearchIndex(0);
      }
    }, 320);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, loading, error]);

  /** 切到其他 Tab 前立即落盘 */
  useEffect(() => {
    if (!isActive) {
      if (rafSaveRef.current != null) {
        cancelAnimationFrame(rafSaveRef.current);
        rafSaveRef.current = null;
      }
      enqueueSave();
    }
  }, [isActive, enqueueSave]);

  useEffect(() => {
    let disposed = false;
    mindRef.current = null;
    setLoading(true);
    setError(null);
    onDirtyChange(false);

    (async () => {
      const res = await fetch(`/api/study/tabs/${tabId}/mindmap`);
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        file?: { data?: unknown };
        error?: string;
      };
      if (disposed) return;
      if (!res.ok || !j.ok || !j.file?.data) {
        setError(j.error ?? "无法加载脑图");
        setLoading(false);
        return;
      }

      const MindElixirMod = await import("mind-elixir");
      const MindElixir = MindElixirMod.default;
      const el = containerRef.current;
      if (!el || disposed) return;

      const rawData = j.file.data as { direction?: number; theme?: unknown };
      const d = typeof rawData?.direction === "number" ? rawData.direction : MindElixir.LEFT;
      const direction = (d === 0 || d === 1 || d === 2 ? d : MindElixir.LEFT) as 0 | 1 | 2;

      const mind = new MindElixir({
        el,
        direction,
        editable: true,
        contextMenu: true,
        toolBar: true,
        keypress: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mind.init(j.file.data as any);
      mind.clearHistory?.();
      mindRef.current = mind;

      const bus = mind.bus;
      bus.addListener("operation", () => enqueueSave());
      bus.addListener("changeDirection", () => enqueueSave());
      bus.addListener("scale", () => enqueueSaveOnFrame());
      bus.addListener("move", () => enqueueSaveOnFrame());

      setLoading(false);
    })();

    return () => {
      disposed = true;
      if (rafSaveRef.current != null) {
        cancelAnimationFrame(rafSaveRef.current);
        rafSaveRef.current = null;
      }
      const m = mindRef.current;
      if (m) {
        try {
          const data = m.getData();
          void fetch(`/api/study/tabs/${tabId}/mindmap`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data }),
            keepalive: true,
          }).catch(() => {
            /* 卸载/切 Tab 时网络失败不抛到全局，避免 Next 覆盖层 */
          });
        } catch {
          /* ignore */
        }
      }
      try {
        m?.destroy?.();
      } catch {
        /* ignore */
      }
      mindRef.current = null;
    };
  }, [tabId, onDirtyChange, enqueueSave, enqueueSaveOnFrame]);

  const jumpToCurrentHit = useCallback(() => {
    const mind = mindRef.current;
    if (!mind) return;
    const q = searchQuery.trim();
    if (!q) return;
    let hits = searchHits;
    if (hits.length === 0) {
      try {
        const data = mind.getData();
        hits = searchMindMapNodesPreorder(data?.nodeData, q);
        setSearchHits(hits);
        setSearchIndex(0);
      } catch {
        return;
      }
    }
    if (hits.length === 0) return;
    const idx = Math.min(searchIndex, hits.length - 1);
    const id = hits[idx]?.id;
    if (id) focusSearchHit(id);
  }, [searchQuery, searchHits, searchIndex, focusSearchHit]);

  const goPrevHit = useCallback(() => {
    setSearchIndex((prev) => {
      const hits = searchHitsRef.current;
      if (hits.length === 0) return prev;
      const n = hits.length;
      const ni = (prev - 1 + n) % n;
      const id = hits[ni]?.id;
      if (id) queueMicrotask(() => focusSearchHit(id));
      return ni;
    });
  }, [focusSearchHit]);

  const goNextHit = useCallback(() => {
    setSearchIndex((prev) => {
      const hits = searchHitsRef.current;
      if (hits.length === 0) return prev;
      const n = hits.length;
      const ni = (prev + 1) % n;
      const id = hits[ni]?.id;
      if (id) queueMicrotask(() => focusSearchHit(id));
      return ni;
    });
  }, [focusSearchHit]);

  return (
    <div className="flex min-h-[480px] flex-1 flex-col gap-2">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">加载脑图…</p> : null}
      {!loading && !error ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-slate-600">
            <span className="shrink-0">搜索节点</span>
            <input
              type="search"
              className="min-w-[10rem] flex-1 rounded border border-slate-200 bg-white px-2 py-1.5"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpToCurrentHit();
                }
              }}
              placeholder="匹配节点文字，回车跳转"
              autoComplete="off"
            />
          </label>
          {searchQuery.trim() ? (
            <span className="shrink-0 text-slate-500">
              {searchHits.length > 0 ? (
                <>
                  {searchIndex + 1} / {searchHits.length}
                </>
              ) : (
                <span className="text-slate-400">无匹配</span>
              )}
            </span>
          ) : null}
          <button
            type="button"
            className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={!searchQuery.trim()}
            onClick={() => {
              setSearchQuery("");
              setSearchHits([]);
              setSearchIndex(0);
              resetSearchCanvasState(mindRef.current);
            }}
          >
            清除
          </button>
          <button
            type="button"
            className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={!searchQuery.trim()}
            onClick={() => jumpToCurrentHit()}
          >
            跳转
          </button>
          <button
            type="button"
            className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={searchHits.length === 0}
            onClick={() => goPrevHit()}
          >
            上一个
          </button>
          <button
            type="button"
            className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={searchHits.length === 0}
            onClick={() => goNextHit()}
          >
            下一个
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="min-h-[420px] w-full flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"
        style={{ minHeight: 420 }}
      />
    </div>
  );
}
