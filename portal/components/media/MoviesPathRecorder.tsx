"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { MOVIES_NAV_PATH_CURR, MOVIES_NAV_PATH_PREV } from "@/lib/movies-nav-storage";

/**
 * 在 /movies/* 内记录 pathname 变化，供合集页判断上一跳是否来自作品详情（才恢复滚动）。
 */
export function MoviesPathRecorder() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const old = sessionStorage.getItem(MOVIES_NAV_PATH_CURR);
    if (old !== pathname) {
      if (old) sessionStorage.setItem(MOVIES_NAV_PATH_PREV, old);
      else sessionStorage.removeItem(MOVIES_NAV_PATH_PREV);
      sessionStorage.setItem(MOVIES_NAV_PATH_CURR, pathname);
    }
  }, [pathname]);

  return null;
}
