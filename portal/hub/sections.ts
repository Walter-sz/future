import { FOOTBALL_APP_BASE } from "@/lib/app-paths";

export type WalterSection = {
  id: string;
  title: string;
  description: string;
  href: string;
  ready: boolean;
};

export function getWalterSections(): WalterSection[] {
  const fb = FOOTBALL_APP_BASE;
  return [
    {
      id: "study",
      title: "持续学习&知识管理",
      description: "多 Tab 工作台：脑图（含 XMind 导入）、本地文件夹知识库与自动保存",
      href: "/study",
      ready: true,
    },
    {
      id: "photos",
      title: "照片管理",
      description: "相册与备份（待建设）",
      href: "/photos",
      ready: false,
    },
    {
      id: "football",
      title: "小川足球",
      description: "Mike 足球训练与成长记录",
      href: fb,
      ready: true,
    },
    {
      id: "movies",
      title: "影视资源",
      description: "按合集浏览与元数据检索",
      href: "/movies",
      ready: true,
    },
    {
      id: "wealth",
      title: "财富管理",
      description: "资产与收支总览（待建设）",
      href: "/wealth",
      ready: false,
    },
    {
      id: "world",
      title: "去看看世界",
      description: "旅行与见闻（待建设）",
      href: "/world",
      ready: false,
    },
  ];
}
