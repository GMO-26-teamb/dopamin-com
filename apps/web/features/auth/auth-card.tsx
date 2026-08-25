import type { ReactNode } from "react";
import { Logo } from "@/components/ui/brand";
import { Divider } from "@/components/ui/card";

/**
 * Figma: S-01 `80:40` / S-02 `80:168`
 * 認証画面（S-01 / S-02 とその派生）の共通の器。440px（`--size-auth-card`）の 1 カラムに
 * Logo → 見出し → Banner → 中身 → 注記 → 罫線 → フッターリンク の順で積む。
 *
 * 非対応環境（S-01c / S-02c）は見出しもフォームも出さないので `title` は任意。
 */
export interface AuthCardProps {
  title?: string;
  /** S-01b / S-02b / S-03 のバナー。メイン先頭に 1 つだけ（ui-screens §1） */
  banner?: ReactNode;
  children?: ReactNode;
  /** ボタン下の補足（Caption / Muted） */
  note?: string;
  footer?: ReactNode;
}

export function AuthCard({
  title,
  banner,
  children,
  note,
  footer,
}: AuthCardProps) {
  return (
    <main className="flex flex-1 items-center justify-center bg-bg px-6 py-12">
      <div className="flex w-full max-w-auth-card flex-col gap-5">
        <Logo />
        {title === undefined ? null : (
          <h1 className="text-heading-page text-ink">{title}</h1>
        )}
        {banner}
        {children}
        {note === undefined ? null : (
          <p className="text-caption text-muted">{note}</p>
        )}
        {footer === undefined ? null : (
          <>
            <Divider weight="thin" />
            <p className="text-body-sm text-ink">{footer}</p>
          </>
        )}
      </div>
    </main>
  );
}
