import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mike 足球管理",
  description: "Mike 的足球训练与成长记录",
};

export default function FootballSegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
