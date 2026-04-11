"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOOTBALL_APP_BASE } from "@/lib/app-paths";

const base = FOOTBALL_APP_BASE;

const tabs = [
  { href: base, label: "Portal" },
  { href: `${base}/media`, label: "图片/视频资料" },
  { href: `${base}/skills`, label: "个人技术" },
  { href: `${base}/game-reading`, label: "球商/大局观" },
] as const;

export function MainNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-lg font-semibold text-slate-800">Mike 足球管理</div>
        <nav className="flex flex-wrap gap-1" aria-label="主导航">
          {tabs.map((t) => {
            const active =
              t.href === base
                ? pathname === base || pathname.startsWith(`${base}/portal`)
                : pathname === t.href || pathname.startsWith(`${t.href}/`);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-emerald-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
