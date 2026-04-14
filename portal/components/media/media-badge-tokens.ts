/** 观影角标与资源角标共用：以「有资源/无资源」刚好舒适显示为基准的紧凑尺寸（无 min-w，两字标签会略窄于三字，属正常） */

export const mediaBadgeInlineShell =
  "inline-flex shrink-0 items-center justify-center rounded-full border-2 px-2 py-0.5 text-xs font-bold leading-none sm:px-2.5 sm:py-1 sm:text-sm shadow-md";

/** 与「已看」相同 */
export const mediaBadgePositiveCls =
  "border-emerald-400/90 bg-emerald-600 text-white ring-2 ring-emerald-300/60 ring-offset-1 ring-offset-transparent";

/** 与「未看」相同 */
export const mediaBadgeMutedCls =
  "border-amber-500/90 bg-amber-50 text-amber-950 ring-2 ring-amber-200/80 ring-offset-1 ring-offset-white/80";
