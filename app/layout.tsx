import type { Metadata } from "next";
import "./globals.css";

export function generateMetadata(): Metadata {
  const title = "CP 跳动 · Couple DANCE";
  const description = "在同一页完成角色建档与动作制作，再观察互动、绑定双向关系，让角色在会持续记忆的像素世界里自然相遇。";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
