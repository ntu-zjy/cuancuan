import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "攒攒 · 任何想认识的人，都可以说给攒攒听",
  description: "从一段自然对话开始，理解你的真实意图，连接合适的人与机会。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
