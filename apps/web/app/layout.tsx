import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ドパ民.com",
  description: "考えるのは楽しく、設定は考えなくていい。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
