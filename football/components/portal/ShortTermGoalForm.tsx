"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveShortTermGoal } from "@/app/actions/data";

export function ShortTermGoalForm({ initialContent }: { initialContent: string }) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-base font-semibold text-slate-800">短期目标</h2>
      <p className="mb-2 text-xs text-slate-500">
        例如：2026 年 5 月底之前，体重控制在 36 公斤，完成各项速度目标等。
      </p>
      <textarea
        className="mb-3 min-h-[120px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="写下当前阶段的短期目标…"
        aria-label="短期目标"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await saveShortTermGoal(content);
            router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "保存中…" : "保存"}
      </button>
    </section>
  );
}
