/**
 * 观影状态角标：合集卡片海报角、搜索列表、详情页统一视觉。
 */
import { mediaBadgeInlineShell, mediaBadgeMutedCls, mediaBadgePositiveCls } from "@/components/media/media-badge-tokens";

export function WatchStatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const watched = status === "watched";
  const label = watched ? "已看" : "未看";
  const tone = watched ? mediaBadgePositiveCls : mediaBadgeMutedCls;

  return (
    <span className={`${mediaBadgeInlineShell} ${tone} ${className}`} aria-label={watched ? "已看过" : "未看过"}>
      {label}
    </span>
  );
}
