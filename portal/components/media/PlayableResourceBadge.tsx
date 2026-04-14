/**
 * 资源库内是否已有可索引播放路径（与列表筛选语义一致）。
 * 形态与 {@link WatchStatusBadge} 一致：有资源 ≈ 已看（翠绿），无资源 ≈ 未看（琥珀底）。
 */
import { mediaBadgeInlineShell, mediaBadgeMutedCls, mediaBadgePositiveCls } from "@/components/media/media-badge-tokens";

export function PlayableResourceBadge({
  hasIndexedPlayableResource,
  className = "",
}: {
  hasIndexedPlayableResource: boolean;
  className?: string;
}) {
  const tone = hasIndexedPlayableResource ? mediaBadgePositiveCls : mediaBadgeMutedCls;

  return (
    <span
      className={`pointer-events-none select-none ${mediaBadgeInlineShell} ${tone} ${className}`}
      aria-label={
        hasIndexedPlayableResource
          ? "资源库内已索引路径，有可播放资源"
          : "无可播放资源，仅属性或占位路径"
      }
    >
      {hasIndexedPlayableResource ? "有资源" : "无资源"}
    </span>
  );
}
