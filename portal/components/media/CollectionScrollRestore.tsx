"use client";

import { useLayoutEffect } from "react";
import { MOVIES_NAV_PATH_PREV } from "@/lib/movies-nav-storage";

/**
 * - 从作品详情返回/进入合集：恢复离开前的纵向滚动。
 * - 从影视首页等其它入口进入合集：滚到顶部，并清掉误继承的滚动值（避免沿用 /movies 的 scroll）。
 */
export function CollectionScrollRestore({ collectionSlug, children }: { collectionSlug: string; children: React.ReactNode }) {
  const key = `movies-collection-scroll:${collectionSlug}`;

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const prevPath = sessionStorage.getItem(MOVIES_NAV_PATH_PREV) || "";
    const fromWorkDetail = /^\/movies\/work\/\d+$/.test(prevPath);

    const applyRestore = () => {
      const raw = sessionStorage.getItem(key);
      if (raw == null) return;
      const y = Number.parseInt(raw, 10);
      if (Number.isNaN(y) || y < 0) return;
      window.scrollTo(0, y);
    };

    if (fromWorkDetail) {
      applyRestore();
      requestAnimationFrame(() => applyRestore());
    } else {
      sessionStorage.removeItem(key);
      window.scrollTo(0, 0);
    }

    const onScroll = () => {
      sessionStorage.setItem(key, String(window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      sessionStorage.setItem(key, String(window.scrollY));
    };
  }, [key]);

  return <>{children}</>;
}
