"use client";

import { ArrowRight, ShieldCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";
import { cn } from "@/lib/utils";
import { BrandBar } from "./brand";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Input } from "./input";

/**
 * Figma: Dialog `53:10` / Dialog / Form `76:312` / Dialog / Danger `76:360` /
 * Dialog / Success `76:406`
 *
 * radix Dialog。420px 幅・2px 枠・上端にブランド帯（Danger だけ帯なしの warn 枠）。
 * 出現アニメーションは `useReducedMotion` が true のとき 0 秒（要件 §15.3）。
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const TONE_BORDER = {
  default: "border-line",
  danger: "border-warn",
} as const;

const OPEN_DURATION_S = 0.16;

/**
 * Description を持たないダイアログでは radix の警告を止めるため
 * `aria-describedby` を明示的に外す（radix 側の既定 id を上書きする）。
 */
function describedBy(hasDescription: boolean): {
  "aria-describedby"?: undefined;
} {
  return hasDescription ? {} : { "aria-describedby": undefined };
}

export interface DialogContentProps
  extends ComponentProps<typeof DialogPrimitive.Content> {
  tone?: "default" | "danger";
  /** 上端のブランド帯。Figma の Danger は帯なし */
  brandBar?: boolean;
  /** 本文コンテナ（px-6 py-5 gap-3）の上書き */
  bodyClassName?: string;
}

export function DialogContent({
  tone = "default",
  brandBar = tone !== "danger",
  bodyClassName,
  className,
  children,
  ...props
}: DialogContentProps) {
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : OPEN_DURATION_S;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay asChild>
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-40 bg-overlay"
          initial={{ opacity: 0 }}
          transition={{ duration }}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content asChild {...props}>
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-dvh w-dialog max-w-[calc(100vw-2rem)] flex-col items-start overflow-y-auto border-2 border-solid bg-panel focus:outline-none",
            TONE_BORDER[tone],
            className,
          )}
          initial={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
          style={{ x: "-50%", y: "-50%" }}
          transition={{ duration }}
        >
          {brandBar ? <BrandBar className="w-full shrink-0" /> : null}
          <div
            className={cn(
              "flex w-full flex-col gap-3 px-6 py-5",
              bodyClassName,
            )}
          >
            {children}
          </div>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export interface DialogHeaderProps extends ComponentProps<"div"> {
  showClose?: boolean;
  closeLabel?: string;
}

export function DialogHeader({
  showClose = true,
  closeLabel = "閉じる",
  className,
  children,
  ...props
}: DialogHeaderProps) {
  return (
    <div
      className={cn("flex w-full items-start justify-between gap-2", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      {showClose ? (
        <DialogPrimitive.Close asChild>
          <IconButton
            aria-label={closeLabel}
            icon={<X />}
            size="sm"
            variant="subtle"
          />
        </DialogPrimitive.Close>
      ) : null}
    </div>
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("w-full text-heading-card text-ink", className)}
      {...props}
    />
  );
}

/** body = 本文（13px）/ subtitle = タイトル直下の補足（11px） */
const DESCRIPTION_VARIANT = {
  body: "text-body-sm",
  subtitle: "text-caption",
} as const;

export interface DialogDescriptionProps
  extends ComponentProps<typeof DialogPrimitive.Description> {
  variant?: "body" | "subtitle";
}

export function DialogDescription({
  variant = "body",
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "w-full text-muted",
        DESCRIPTION_VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-end gap-2 pt-1",
        className,
      )}
      {...props}
    />
  );
}

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void | Promise<void>;
  primaryVariant?: "primary" | "solid" | "outline";
  secondaryLabel?: string;
  busy?: boolean;
  primaryDisabled?: boolean;
}

/** フォーム系ダイアログ（更新 / 情報修正 / 移管 IN / AI 設定など）。 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryVariant = "primary",
  secondaryLabel = "キャンセル",
  busy = false,
  primaryDisabled = false,
}: FormDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent {...describedBy(subtitle !== undefined)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle === undefined ? null : (
            <DialogDescription variant="subtitle">{subtitle}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex w-full flex-col gap-3">{children}</div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={busy} variant="subtle">
              {secondaryLabel}
            </Button>
          </DialogClose>
          <Button
            disabled={primaryDisabled}
            loading={busy}
            onClick={() => {
              void onPrimary();
            }}
            variant={primaryVariant}
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface DangerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  /** 入力欄の上に出す注意書き */
  note?: string;
  /** この文字列と入力が一致するまで主要ボタンを押せない */
  confirmText: string;
  /** 入力欄のラベル（例「確認のためドメイン名を入力」） */
  confirmLabel: string;
  /** 視覚ラベルと別の読み上げ名を付けたいときだけ指定する */
  inputLabel?: string;
  primaryLabel: string;
  primaryVariant?: "danger" | "solid";
  onPrimary: () => void | Promise<void>;
  busy?: boolean;
}

/** 破壊的操作の確認（廃止・AuthCode 発行など、要件 §15.2）。 */
export function DangerDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  note,
  confirmText,
  confirmLabel,
  inputLabel,
  primaryLabel,
  primaryVariant = "danger",
  onPrimary,
  busy = false,
}: DangerDialogProps) {
  const [typed, setTyped] = useState("");

  // 開くたびに入力を捨てる（前回の一致状態を持ち越さない）
  useEffect(() => {
    if (open) {
      setTyped("");
    }
  }, [open]);

  const matched = typed.trim() === confirmText;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent tone="danger" {...describedBy(subtitle !== undefined)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle === undefined ? null : (
            <DialogDescription variant="subtitle">{subtitle}</DialogDescription>
          )}
        </DialogHeader>
        {note === undefined ? null : (
          <p className="w-full text-caption text-muted">{note}</p>
        )}
        <Input
          aria-label={inputLabel}
          autoComplete="off"
          label={confirmLabel}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={confirmText}
          surface="panel"
          value={typed}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={busy} variant="subtle">
              キャンセル
            </Button>
          </DialogClose>
          <Button
            disabled={!matched}
            loading={busy}
            onClick={() => {
              void onPrimary();
            }}
            variant={primaryVariant}
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface SuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  domain?: string;
  body: string;
  primaryLabel: string;
  onPrimary: () => void | Promise<void>;
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
}

/** 登録・復旧・更新の成功（FR-06）。中央寄せ・盾アイコン・次の一手を出す。 */
export function SuccessDialog({
  open,
  onOpenChange,
  title,
  domain,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: SuccessDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent bodyClassName="items-center gap-3 px-6 pt-8 pb-5 text-center">
        <ShieldCheck aria-hidden="true" className="size-10 shrink-0 text-ink" />
        <DialogTitle className="text-heading-page">{title}</DialogTitle>
        {domain === undefined ? null : (
          <p className="w-full text-domain-lg text-ink">{domain}</p>
        )}
        <DialogDescription>{body}</DialogDescription>
        <DialogFooter className="justify-center pt-2">
          {secondaryLabel === undefined ? null : (
            <Button
              onClick={() => {
                void onSecondary?.();
              }}
              variant="outline"
            >
              {secondaryLabel}
            </Button>
          )}
          <Button
            onClick={() => {
              void onPrimary();
            }}
            trailingIcon={<ArrowRight />}
            variant="primary"
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
