"use client";

import { useEffect, useState } from "react";
import { parseXmindFileToMindElixirData } from "@/lib/study-xmind-import";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 新建 Tab 的数据库 id，用于自动切换到该 Tab */
  onCreated: (newTabId: number) => void;
};

export function AddStudyTabDialog({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<"type" | "mindmap" | "folder">("type");
  const [title, setTitle] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [mindMode, setMindMode] = useState<"blank" | "xmind" | "json">("blank");
  const [file, setFile] = useState<File | null>(null);
  /** 打开已有 JSON：服务端绝对路径（与空白/XMind 不同，不复制到数据目录） */
  const [jsonPath, setJsonPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 服务端是否为本机 macOS（可用 osascript 弹出访达） */
  const [folderPickSupported, setFolderPickSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open || (step !== "folder" && step !== "mindmap")) return;
    let cancelled = false;
    void fetch("/api/study/folder/pick")
      .then((r) => r.json())
      .then((j: { supported?: boolean }) => {
        if (!cancelled) setFolderPickSupported(!!j.supported);
      })
      .catch(() => {
        if (!cancelled) setFolderPickSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, step]);

  const reset = () => {
    setStep("type");
    setTitle("");
    setFolderPath("");
    setMindMode("blank");
    setFile(null);
    setJsonPath("");
    setError(null);
    setBusy(false);
    setFolderPickSupported(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submitMindmap = async () => {
    const t = title.trim() || "未命名脑图";
    setBusy(true);
    setError(null);
    try {
      if (mindMode === "xmind") {
        if (!file) {
          setError("请选择 .xmind 文件");
          setBusy(false);
          return;
        }
        const data = await parseXmindFileToMindElixirData(file, t);
        const res = await fetch("/api/study/tabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: t,
            tabType: "mindmap",
            mindmapMode: "xmind_import",
            mindMapData: data,
          }),
        });
        const j = (await res.json()) as { ok?: boolean; tab?: { id: number }; error?: string };
        if (!res.ok || !j.ok || j.tab?.id == null) throw new Error(j.error ?? "创建失败");
        onCreated(j.tab.id);
        handleClose();
        return;
      }
      if (mindMode === "json") {
        const p = jsonPath.trim();
        if (!p) {
          setError("请填写或通过访达选择脑图 JSON 的绝对路径");
          setBusy(false);
          return;
        }
        const res = await fetch("/api/study/tabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tabType: "mindmap",
            mindmapMode: "json_open",
            mindMapJsonPath: p,
          }),
        });
        const j = (await res.json()) as { ok?: boolean; tab?: { id: number }; error?: string };
        if (!res.ok || !j.ok || j.tab?.id == null) throw new Error(j.error ?? "创建失败");
        onCreated(j.tab.id);
        handleClose();
        return;
      }
      const res = await fetch("/api/study/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          tabType: "mindmap",
          mindmapMode: "blank",
        }),
      });
      const j = (await res.json()) as { ok?: boolean; tab?: { id: number }; error?: string };
      if (!res.ok || !j.ok || j.tab?.id == null) throw new Error(j.error ?? "创建失败");
      onCreated(j.tab.id);
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitFolder = async () => {
    const t = title.trim();
    const p = folderPath.trim();
    if (!p) {
      setError("请填写目录路径");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await fetch("/api/study/folder/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const vj = (await v.json()) as { ok?: boolean; error?: string };
      if (!v.ok || !vj.ok) throw new Error(vj.error ?? "路径无效");

      const res = await fetch("/api/study/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          tabType: "folder",
          folderPath: p,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; tab?: { id: number }; error?: string };
      if (!res.ok || !j.ok || j.tab?.id == null) throw new Error(j.error ?? "创建失败");
      onCreated(j.tab.id);
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickJsonWithFinder = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/study/mindmap/pick-json", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; path?: string; error?: string };
      if (!res.ok || !j.ok || typeof j.path !== "string") throw new Error(j.error ?? "选择失败");
      setJsonPath(j.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFolderWithFinder = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/study/folder/pick", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; path?: string; error?: string };
      if (!res.ok || !j.ok || typeof j.path !== "string") throw new Error(j.error ?? "选择失败");
      setFolderPath(j.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-800">新建 Tab</h2>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        {step === "type" ? (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm hover:bg-slate-50"
              onClick={() => setStep("mindmap")}
            >
              知识脑图（Mind Elixir）
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm hover:bg-slate-50"
              onClick={() => setStep("folder")}
            >
              文件夹（Obsidian / 笔记库等，需服务端白名单路径）
            </button>
            <button type="button" className="mt-2 text-sm text-slate-500 hover:text-slate-700" onClick={handleClose}>
              取消
            </button>
          </div>
        ) : null}

        {step === "mindmap" ? (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            {mindMode === "json" ? (
              <p className="text-xs leading-relaxed text-slate-600">
                直接打开服务端磁盘上的 JSON 文件，编辑会写回该文件；不会在数据目录再复制一份。Tab 名称将使用文件名（不含
                .json）。请填写 Portal 所在机器上的绝对路径；在本机 macOS 上可用访达选择。
              </p>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-slate-600">标题</span>
                <input
                  className="rounded border border-slate-200 px-3 py-2"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="脑图名称"
                />
              </label>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={mindMode === "blank"}
                  onChange={() => {
                    setMindMode("blank");
                    setFile(null);
                    setJsonPath("");
                  }}
                />
                空白脑图
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={mindMode === "xmind"}
                  onChange={() => {
                    setMindMode("xmind");
                    setFile(null);
                    setJsonPath("");
                  }}
                />
                导入 XMind（.xmind，Zen）
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={mindMode === "json"}
                  onChange={() => {
                    setMindMode("json");
                    setFile(null);
                    setJsonPath("");
                  }}
                />
                打开本地脑图 JSON
              </label>
            </div>
            {mindMode === "xmind" ? (
              <label className="flex flex-col gap-1">
                <span className="text-slate-600">选择文件</span>
                <input
                  type="file"
                  accept=".xmind,application/zip"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : null}
            {mindMode === "json" ? (
              <label className="flex flex-col gap-1">
                <span className="text-slate-600">JSON 绝对路径（须在白名单根目录内）</span>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <input
                    className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2 font-mono text-xs"
                    value={jsonPath}
                    onChange={(e) => setJsonPath(e.target.value)}
                    placeholder="/Users/you/Documents/笔记.json"
                  />
                  {folderPickSupported ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void pickJsonWithFinder()}
                    >
                      用访达选择…
                    </button>
                  ) : null}
                </div>
                {folderPickSupported === false ? (
                  <p className="text-xs text-slate-500">
                    当前环境无法用访达选路径时，请手动填写运行 Portal 的机器上的 .json 绝对路径。
                  </p>
                ) : folderPickSupported === null ? (
                  <p className="text-xs text-slate-400">正在检测访达是否可用…</p>
                ) : null}
              </label>
            ) : null}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                disabled={busy}
                onClick={() => void submitMindmap()}
              >
                {busy ? "创建中…" : "创建"}
              </button>
              <button type="button" className="text-slate-500" onClick={() => setStep("type")}>
                返回
              </button>
            </div>
          </div>
        ) : null}

        {step === "folder" ? (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-slate-600">Tab 标题（可选，留空则用所选文件夹名称）</span>
              <input
                className="rounded border border-slate-200 px-3 py-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="留空则与文件夹同名"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-600">
                目录绝对路径（默认白名单为本机用户主目录；可设 STUDY_ALLOWED_ROOTS 指定其它根目录）
              </span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <input
                  className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2 font-mono text-xs"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/volume1/obsidian/vault"
                />
                {folderPickSupported ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void pickFolderWithFinder()}
                  >
                    用访达选择…
                  </button>
                ) : null}
              </div>
              {folderPickSupported === false ? (
                <p className="text-xs text-slate-500">
                  当前 Portal 未在本机 macOS 上运行，无法弹出访达。请手动填写路径；或在访达中选中文件夹后按 ⌥⌘C（复制为路径）再粘贴到上方。
                </p>
              ) : folderPickSupported === null ? (
                <p className="text-xs text-slate-400">正在检测是否可用访达选目录…</p>
              ) : (
                <p className="text-xs text-slate-500">
                  也可在访达中选中文件夹后按 ⌥⌘C 复制路径，粘贴到输入框。
                </p>
              )}
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                disabled={busy}
                onClick={() => void submitFolder()}
              >
                {busy ? "创建中…" : "创建"}
              </button>
              <button type="button" className="text-slate-500" onClick={() => setStep("type")}>
                返回
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
