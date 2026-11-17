import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "BoxPhim trên Telegram" },
  robots: { index: false, follow: false },
};

export default function TelegramLayout({ children }: LayoutProps<"/tg">) {
  return children;
}
