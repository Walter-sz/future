import { PlayableResourceBadge } from "@/components/media/PlayableResourceBadge";
import { WatchStatusBadge } from "@/components/media/WatchStatusBadge";

type Props = {
  watchStatus: string;
  hasIndexedPlayableResource: boolean;
  /** 叠在可点击海报上时不抢指针 */
  pointerEventsNone?: boolean;
  className?: string;
};

/**
 * 观影角标与资源角标纵向排列：列宽由「有资源/无资源」自然宽度决定，「已看/未看」拉满同宽（不改动资源角标 padding/字号）。
 */
export function MediaWatchResourceStack({
  watchStatus,
  hasIndexedPlayableResource,
  pointerEventsNone,
  className = "",
}: Props) {
  const pe = pointerEventsNone ? "pointer-events-none" : "";
  return (
    <div className={`inline-grid w-max grid-cols-[max-content] gap-y-1.5 ${pe} ${className}`}>
      <WatchStatusBadge status={watchStatus} className="w-full min-w-0" />
      <PlayableResourceBadge
        hasIndexedPlayableResource={hasIndexedPlayableResource}
        className="justify-self-end"
      />
    </div>
  );
}
