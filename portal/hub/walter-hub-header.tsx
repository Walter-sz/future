"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAgentRouteTitle } from "@/hub/agents";

const SUBPAGE_TITLES: Record<string, string> = {
  "/study": "学习&知识管理",
  "/photos": "照片管理",
  "/movies": "影视资源",
  "/wealth": "财富管理",
  "/world": "去看看世界",
};

export function WalterHubHeader() {
  const pathname = usePathname() || "/";
  const isHome = pathname === "/";
  const subTitle =
    SUBPAGE_TITLES[pathname] ??
    (pathname.startsWith("/movies/") ? "影视资源" : undefined) ??
    getAgentRouteTitle(pathname);

  return (
    <header className="border-b border-amber-200/60 bg-white/90 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 py-4">
        {isHome ? (
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <Link
              href="/"
              scroll={false}
              className="text-2xl font-bold tracking-tight text-slate-900"
            >
              Walter&apos;s world
            </Link>
            <p className="text-sm text-slate-500">个人主页 · 信息与活动总览</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link
                href="/"
                scroll={false}
                className="text-sm font-medium text-amber-700 hover:text-amber-800 hover:underline"
              >
                ← Walter&apos;s world
              </Link>
              {subTitle ? (
                <>
                  <span className="hidden text-slate-300 sm:inline" aria-hidden>
                    |
                  </span>
                  <h1 className="text-lg font-semibold text-slate-800">{subTitle}</h1>
                </>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">个人主页 · 信息与活动总览</p>
          </>
        )}
      </div>
    </header>
  );
}
