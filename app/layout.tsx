import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "攒攒 · 基于真实意图，攒成一个局",
  description: "寻找合作伙伴、玩伴、相亲对象，或攒一个招聘、创投与旅行的局。先说清需求，再找到合适的人。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
