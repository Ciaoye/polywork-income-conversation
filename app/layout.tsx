import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "你在做什么？怎么做？｜多元工作与多元收入聊天会";
  const description = "先让每个人同时思考，再让真实回答成为现场谈话的开始。";
  return {
    metadataBase: base,
    title,
    description,
    icons: { icon: "/event-icon.png", shortcut: "/event-icon.png" },
    openGraph: { title, description, type: "website", images: [{ url: new URL("/og.png", base).toString(), width: 1731, height: 909 }] },
    twitter: { card: "summary_large_image", title, description, images: [new URL("/og.png", base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
