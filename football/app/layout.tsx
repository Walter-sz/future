import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mike 足球管理",
  description: "Mike 的足球训练与成长记录",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
