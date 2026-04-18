"use client";

import { useCallback, useEffect, useState } from "react";
import { parseStudyTabConfig } from "@/lib/study-types";

function parentDirectory(current: string, root: string): string {
  const r = root.replace(/[/\\]+$/, "") || root;
  const c = current.replace(/[/\\]+$/, "") || current;
  if (c === r) return root;
  const i = Math.max(c.lastIndexOf("/"), c.lastIndexOf("\\"));
  if (i <= 0) return root;
  const p = c.slice(0, i);
  return p.length >= r.length ? p : root;
}

type Props = {
  tabId: number;
  configJson: string;
  onDirtyChange: (dirty: boolean) => void;
};

type Entry = { name: string; path: string; isDirectory: boolean };

export function StudyFolderPanel({ tabId, configJson, onDirtyChange }: Props) {
  const cfg = parseStudyTabConfig(configJson);
  const root = typeof cfg.serverPath === "string" ? cfg.serverPath : "";
  const [cwd, setCwd] = useState(root);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/study/folder/browse?path=${encodeURIComponent(path)}`);
        const j = (await res.json()) as { ok?: boolean; entries?: Entry[]; error?: string };
        if (!res.ok || !j.ok) throw new Error(j.error ?? "无法列出目录");
        setEntries(j.entries ?? []);
        setCwd(path);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (root) void loadDir(root);
  }, [root, loadDir, tabId]);

  const openFile = async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/study/folder/file?path=${encodeURIComponent(p)}`);
      const j = (await res.json()) as { ok?: boolean; content?: string; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "无法读取文件");
      setFilePath(p);
      setContent(j.content ?? "");
      onDirtyChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/study/folder/file?path=${encodeURIComponent(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "保存失败");
      onDirtyChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!root) {
    return <p className="text-sm text-slate-500">未配置有效文件夹路径。</p>;
  }

  return (
    <div className="flex min-h-[420px] flex-col gap-3 lg:flex-row">
      <div className="w-full shrink-0 rounded-lg border border-slate-200 bg-white lg:w-72">
        <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
          {cwd === root ? (
            <span>根目录</span>
          ) : (
            <button
              type="button"
              className="text-amber-700 hover:underline"
              onClick={() => {
                void loadDir(parentDirectory(cwd, root));
              }}
            >
              ↑ 上级
            </button>
          )}
        </div>
        <ul className="max-h-[360px] overflow-auto p-1 text-sm">
          {loading && entries.length === 0 ? <li className="px-2 py-1 text-slate-400">加载中…</li> : null}
          {entries.map((e) => (
            <li key={e.path}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left hover:bg-slate-50"
                onClick={() => {
                  if (e.isDirectory) void loadDir(e.path);
                  else void openFile(e.path);
                }}
              >
                {e.isDirectory ? "📁 " : "📄 "}
                {e.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-h-[360px] min-w-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white">
        {error ? <p className="p-2 text-sm text-red-600">{error}</p> : null}
        {filePath ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
              <span className="truncate font-mono">{filePath}</span>
              <button
                type="button"
                className="rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700"
                onClick={() => void saveFile()}
              >
                保存
              </button>
            </div>
            <textarea
              className="min-h-[320px] flex-1 resize-none p-3 font-mono text-sm text-slate-800 outline-none"
              value={content}
              onChange={(ev) => {
                setContent(ev.target.value);
                onDirtyChange(true);
              }}
            />
          </>
        ) : (
          <p className="p-6 text-sm text-slate-500">选择左侧文件进行查看与编辑（文本类）。</p>
        )}
      </div>
    </div>
  );
}
