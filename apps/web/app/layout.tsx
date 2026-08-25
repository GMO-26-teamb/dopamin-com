import type { Metadata } from "next";
import {
  Archivo,
  JetBrains_Mono,
  Noto_Sans_JP,
  Yuji_Boku,
} from "next/font/google";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import "./globals.css";

// variable 名は app/tokens.css の --font-jp / --font-latin / --font-goku / --font-mono が参照する
const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});

const yujiBoku = Yuji_Boku({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-yuji-boku",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const fontVariables = [
  notoSansJp.variable,
  archivo.variable,
  yujiBoku.variable,
  jetBrainsMono.variable,
].join(" ");

/**
 * ハイドレーション前に data-theme を確定させ、極ドパモードのちらつきを防ぐ。
 * lib/theme/theme-provider.tsx の THEME_STORAGE_KEY / THEMES と同じ値を使う。
 */
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("dopamin-theme");document.documentElement.dataset.theme=(t==="goku"||t==="standard")?t:"standard"}catch(e){document.documentElement.dataset.theme="standard"}`;

export const metadata: Metadata = {
  title: "ドパ民.com",
  description: "考えるのは楽しく、設定は考えなくていい。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      data-theme="standard"
      suppressHydrationWarning
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ハイドレーション前に走らせる必要のある静的スクリプト（外部入力なし） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
