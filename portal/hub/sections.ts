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
      title: "学习&知识管理",
      description: "课程、笔记与知识库（待建设）",
      href: "/study",
      ready: false,
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
      description: "片单与媒体库（待建设）",
      href: "/movies",
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
