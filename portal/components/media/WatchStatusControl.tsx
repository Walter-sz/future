"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WatchStatusBadge } from "@/components/media/WatchStatusBadge";

type Props = {
  workId: number;
  initialStatus: string;
};

export function WatchStatusControl({ workId, initialStatus }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setWatch(next: "watched" | "unwatched") {
    setPending(true);
    setErr(null);
    try {
      const r = await fetch(`/api/media/work/${workId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchStatus: next }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) {
        throw new Error(data.error || "更新失败");
      }
      setStatus(next);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900">观影状态</p>
        <WatchStatusBadge status={status} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || status === "unwatched"}
          onClick={() => setWatch("unwatched")}
          className={`rounded-full border-2 px-4 py-2 text-sm font-semibold transition ${
            status === "unwatched"
              ? "border-amber-500 bg-amber-50 text-amber-950 shadow-inner ring-2 ring-amber-200/70"
              : "border-slate-300 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50/50 disabled:opacity-45"
          }`}
        >
          标记未看
        </button>
        <button
          type="button"
          disabled={pending || status === "watched"}
          onClick={() => setWatch("watched")}
          className={`rounded-full border-2 px-4 py-2 text-sm font-semibold transition ${
            status === "watched"
              ? "border-emerald-500 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300/50"
              : "border-emerald-300/80 bg-emerald-50/90 text-emerald-900 hover:bg-emerald-100 disabled:opacity-45"
          }`}
        >
          标记已看
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
    </div>
  );
}
