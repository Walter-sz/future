export type WalterAgent = {
  /** URL 段，如 /agent/butler */
  slug: string;
  title: string;
  description: string;
  /** 是否已接入后端/自动化 */
  ready: boolean;
};

export function getWalterAgents(): WalterAgent[] {
  return [
    {
      slug: "butler",
      title: "管家 Agent",
      description: "日常事务、提醒与家庭协调（待接入）",
      ready: false,
    },
    {
      slug: "photos",
      title: "照片管理 Agent",
      description: "整理、标注与相册策略（待接入）",
      ready: false,
    },
    {
      slug: "knowledge",
      title: "知识管理 Agent",
      description: "笔记摘要、主题归纳与学习节奏（待接入）",
      ready: false,
    },
    {
      slug: "media",
      title: "影视资源 Agent",
      description: "片单维护、观影记录与资源整理（待接入）",
      ready: false,
    },
    {
      slug: "news",
      title: "时事资讯 Agent",
      description: "订阅聚合、摘要与要点推送（待接入）",
      ready: false,
    },
    {
      slug: "calendar",
      title: "日程管理 Agent",
      description: "日历同步、冲突检测与提醒策略（待接入）",
      ready: false,
    },
  ];
}

export function getAgentBySlug(slug: string): WalterAgent | undefined {
  return getWalterAgents().find((a) => a.slug === slug);
}

/** 用于顶栏：根据 pathname 解析 Agent 标题 */
export function getAgentRouteTitle(pathname: string): string | undefined {
  if (!pathname.startsWith("/agent/")) return undefined;
  const slug = pathname.slice("/agent/".length).split("/")[0];
  if (!slug) return undefined;
  return getAgentBySlug(slug)?.title;
}
