/**
 * 观影状态角标：合集卡片海报角、搜索列表、详情页统一视觉。
 */
export function WatchStatusBadge({
  status,
  variant = "inline",
  className = "",
}: {
  status: string;
  variant?: "poster" | "inline";
  className?: string;
}) {
  const watched = status === "watched";
  const label = watched ? "已看" : "未看";

  const watchedCls =
    "border-emerald-400/90 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300/60 ring-offset-1 ring-offset-transparent";
  const unwatchedCls =
    "border-amber-500/90 bg-amber-50 text-amber-950 shadow-md ring-2 ring-amber-200/80 ring-offset-1 ring-offset-white/80";

  if (variant === "poster") {
    return (
      <span
        className={`pointer-events-none absolute right-2 top-2 z-10 select-none rounded-full border-2 px-2.5 py-1 text-xs font-bold tracking-wide sm:right-2.5 sm:top-2.5 sm:px-3 sm:py-1.5 sm:text-sm ${watched ? watchedCls : unwatchedCls} ${className}`}
        aria-label={watched ? "已标记为看过" : "未看过"}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border-2 px-2.5 py-1 text-xs font-bold sm:text-sm ${watched ? watchedCls : unwatchedCls} ${className}`}
      aria-label={watched ? "已看过" : "未看过"}
    >
      {label}
    </span>
  );
}
