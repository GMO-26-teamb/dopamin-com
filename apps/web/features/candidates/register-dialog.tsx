"use client";

import {
  DEFAULT_REGISTRANT_PROFILE,
  formatJpy,
  quoteOrder,
  rarityTier,
} from "@dopamin/shared";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { FormDialog } from "@/components/ui/dialog";
import { ErrorCard } from "@/components/ui/error-card";
import { Rarity } from "@/components/ui/rarity";
import { Select, type SelectOption } from "@/components/ui/select";
import { SimilarityRow } from "@/components/ui/similarity-row";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentStep } from "@/features/billing/payment-step";
import { usePaymentStep } from "@/features/billing/use-payment-step";
import {
  compact,
  isAllowedContactName,
  MAX_NAMESERVERS,
  MIN_NAMESERVERS,
  NameserverRows,
  type NsRow,
  newRow,
  RegistrantFields,
  validateNameservers,
  validateRegistrantEmail,
  validateRegistrantName,
} from "@/features/domains/dialogs/ns-contact-fields";
import type { ApiClientError } from "@/lib/api/errors";
import { useCheckDomains, useRegisterDomain } from "@/lib/api/hooks";
import type {
  DomainDetail,
  PaymentReceipt,
  UniquenessScore,
} from "@/lib/api/types";
import { uniquenessText } from "./labels";

/**
 * Figma: S-25 `81:1437`（Dialog / Register `53:53`）
 * ui-screens S-25 → S-29。開いた直後に check を再実行して「空き・再確認済み」を出し、
 * 期間を選んで「お支払いへ」→ お支払いステップ（S-29、モック決済）→ 決済成功で
 * `POST /domains`。
 *
 * ネームサーバーとコンタクトは**畳んだ 1 行**にして、開いたときだけ入力欄を出す。
 * 畳んだままでも何が適用されるかは行に出す（NS は未設定、コンタクトは登録者名）。
 * 入力欄と検証は D-02 情報修正と同じものを使う（`ns-contact-fields.tsx`）。
 */

/** 登録期間は 1〜10 年（domainCreateRequestSchema / AC-08-2）。 */
const PERIOD_OPTIONS: readonly SelectOption[] = Array.from(
  { length: 10 },
  (_, index) => ({ value: `${index + 1}`, label: `${index + 1} 年` }),
);

type Step = "form" | "payment";

export interface RegisterTarget {
  name: string;
  uniqueness: UniquenessScore | null;
}

export interface RegisterDialogProps {
  target: RegisterTarget | null;
  /** S-28 で「登録は行われていません」と分かって戻ってきたとき（ui-screens S-28） */
  notice?: string | null;
  onOpenChange: (open: boolean) => void;
  onRegistered: (domain: DomainDetail, receipt: PaymentReceipt) => void;
  onConflict: (name: string, alternatives: string[]) => void;
  onTimeout: (name: string, error: ApiClientError) => void;
}

export function RegisterDialog({
  target,
  notice = null,
  onOpenChange,
  onRegistered,
  onConflict,
  onTimeout,
}: RegisterDialogProps) {
  const [period, setPeriod] = useState("1");
  const [step, setStep] = useState<Step>("form");
  // NS とコンタクトは折りたたみ。既定は畳んだまま = 今までどおり何も送らない
  const [nsOpen, setNsOpen] = useState(false);
  const [nsRows, setNsRows] = useState<NsRow[]>(() => ["", ""].map(newRow));
  const [contactOpen, setContactOpen] = useState(false);
  const [registrantName, setRegistrantName] = useState<string>(
    DEFAULT_REGISTRANT_PROFILE.name,
  );
  const [registrantEmail, setRegistrantEmail] = useState(
    DEFAULT_REGISTRANT_PROFILE.email,
  );
  /** 「お支払いへ」を押すまでは入力中の欄を赤くしない（D-02 と同じ）。 */
  const [submitted, setSubmitted] = useState(false);
  const recheck = useCheckDomains();
  const register = useRegisterDomain();
  const payment = usePaymentStep();
  const name = target?.name ?? "";

  // 直前に check を再実行する（ui-screens S-25）。開くたびに 1 回だけ。
  const { mutate: runRecheck, reset: resetRecheck } = recheck;
  const { reset: resetRegister } = register;
  const { reset: resetPayment } = payment;
  useEffect(() => {
    if (name === "") {
      return;
    }
    setPeriod("1");
    setStep("form");
    setNsOpen(false);
    setNsRows(["", ""].map(newRow));
    setContactOpen(false);
    setRegistrantName(DEFAULT_REGISTRANT_PROFILE.name);
    setRegistrantEmail(DEFAULT_REGISTRANT_PROFILE.email);
    setSubmitted(false);
    // 前回の失敗（Error Card）やカード入力を持ち越さない
    resetRegister();
    resetRecheck();
    resetPayment();
    runRecheck({ names: [name] });
  }, [name, runRecheck, resetRecheck, resetRegister, resetPayment]);

  const rechecked = recheck.data?.[0];
  const uniqueness = rechecked?.uniqueness ?? target?.uniqueness ?? null;
  const taken = rechecked?.availability === "unavailable";
  const checkFailed =
    recheck.error !== null || rechecked?.availability === "error";
  // 再確認が失敗しただけなら送信は止めない（最終判定はレジストリの create = 409 → S-27）。
  // 止めるのは「確認中」と「取得済みと分かった」ときだけ。
  const canRegister = !recheck.isPending && !taken;

  // 再確認で他者取得と分かったら、そのまま S-27 に移す（ui-screens S-27）
  useEffect(() => {
    if (taken && rechecked !== undefined) {
      onConflict(rechecked.name, rechecked.alternatives);
    }
  }, [taken, rechecked, onConflict]);

  const quote =
    name === ""
      ? null
      : quoteOrder({ kind: "register", domain: name, years: Number(period) });

  // 空欄のままなら送らない（＝レジストリ既定のまま。あとから情報修正で設定できる）
  const nameservers = compact(nsRows.map((row) => row.value));
  const nsError = validateNameservers(nsRows.map((row) => row.value));
  const nameError = validateRegistrantName(registrantName);
  const emailError = validateRegistrantEmail(registrantEmail);
  // 既定のままなら contacts を送らない。API 側の登録者プロファイルはそのままになる
  const contactChanged =
    registrantName.trim() !== DEFAULT_REGISTRANT_PROFILE.name ||
    registrantEmail.trim() !== DEFAULT_REGISTRANT_PROFILE.email;

  /** 畳んだ行に出す「開かなくても分かる」要約。 */
  const [firstNs, ...restNs] = nameservers;
  const nsSummary =
    firstNs === undefined
      ? "未設定のまま登録"
      : restNs.length === 0
        ? firstNs
        : `${firstNs} ほか ${restNs.length} 件`;
  const contactSummary =
    registrantName.trim() === "" ? "未入力" : registrantName.trim();

  const handlePrimary = async () => {
    if (target === null || quote === null) {
      return;
    }
    if (step === "form") {
      // 決済に進む前に弾く。畳んだままの欄に間違いがあれば開いて見せる
      setSubmitted(true);
      if (nsError !== null) {
        setNsOpen(true);
        return;
      }
      if (nameError !== null || emailError !== null) {
        setContactOpen(true);
        return;
      }
      setStep("payment");
      return;
    }
    // お支払い（S-29）: 入力検証 → 決済モック → 成功したときだけ create
    const receipt = await payment.pay(quote);
    if (receipt === null) {
      return;
    }
    const trimmedName = registrantName.trim();
    register.mutate(
      {
        name: target.name,
        period: Number(period),
        ...(nameservers.length > 0 ? { nameservers } : {}),
        // 検証済みだが、`RegistrantProfile["name"]` のユニオンに絞るため再度確認する
        ...(contactChanged && isAllowedContactName(trimmedName)
          ? {
              contacts: {
                registrant: {
                  name: trimmedName,
                  email: registrantEmail.trim(),
                },
              },
            }
          : {}),
      },
      {
        onSuccess: (domain) => onRegistered(domain, receipt),
        onError: (error) => {
          if (error.code === "CONFLICT") {
            onConflict(target.name, rechecked?.alternatives ?? []);
            return;
          }
          if (error.code === "REGISTRY_TIMEOUT") {
            onTimeout(target.name, error);
          }
        },
      },
    );
  };

  const otherError =
    register.error !== null &&
    register.error.code !== "CONFLICT" &&
    register.error.code !== "REGISTRY_TIMEOUT"
      ? register.error
      : null;

  const busy = payment.busy || register.isPending;
  const isPayment = step === "payment";

  return (
    <FormDialog
      busy={busy}
      onOpenChange={(open) => {
        if (!open) {
          register.reset();
        }
        onOpenChange(open);
      }}
      onPrimary={handlePrimary}
      onSecondary={isPayment ? () => setStep("form") : undefined}
      open={target !== null}
      primaryDisabled={!canRegister || quote === null}
      primaryLabel={
        isPayment && quote !== null
          ? `${formatJpy(quote.total)} を支払って登録する`
          : "お支払いへ"
      }
      secondaryLabel={isPayment ? "戻る" : "キャンセル"}
      subtitle={isPayment ? "お支払い" : undefined}
      title={`${name} を登録`}
    >
      {notice === null ? null : (
        <Banner
          body="お支払いは確定していません。もう一度お支払いに進めば再送できます。"
          title={notice}
          tone="info"
        />
      )}

      {isPayment && quote !== null ? (
        <PaymentStep
          busy={busy}
          card={payment.card}
          errors={payment.errors}
          failure={payment.failure}
          onCardChange={payment.setCard}
          quote={quote}
        />
      ) : (
        <>
          <RecheckSummary
            checkFailed={checkFailed}
            pending={recheck.isPending}
            uniqueness={uniqueness}
          />

          <Select
            helper={
              quote === null
                ? undefined
                : `お支払い合計 ${formatJpy(quote.total)}（税込）`
            }
            label="期間 *"
            onValueChange={setPeriod}
            options={PERIOD_OPTIONS}
            surface="panel"
            value={period}
          />
          <CollapsibleField
            label="ネームサーバー"
            onOpenChange={setNsOpen}
            open={nsOpen}
            summary={nsSummary}
          >
            <NameserverRows
              error={submitted ? nsError : null}
              onRowsChange={setNsRows}
              rows={nsRows}
            />
            <p className="w-full text-caption-sm text-muted">
              {MIN_NAMESERVERS}〜{MAX_NAMESERVERS}{" "}
              件。空のままなら未設定で登録し、あとから「情報修正」で変えられます。
            </p>
          </CollapsibleField>

          <CollapsibleField
            label="コンタクト（登録者）"
            onOpenChange={setContactOpen}
            open={contactOpen}
            summary={contactSummary}
          >
            <RegistrantFields
              email={registrantEmail}
              emailError={submitted ? emailError : null}
              name={registrantName}
              nameError={submitted ? nameError : null}
              onEmailChange={setRegistrantEmail}
              onNameChange={setRegistrantName}
            />
            <p className="w-full text-caption-sm text-muted">
              住所と国は配送不能なダミー値で登録します。ここで変えると、保存済みの登録者情報も同じ内容に差し替わります。
            </p>
          </CollapsibleField>
        </>
      )}

      {otherError === null ? null : <ErrorCard error={otherError} />}

      {isPayment ? null : (
        <p className="w-full text-caption text-muted">
          次のステップでお支払いに進みます
        </p>
      )}
    </FormDialog>
  );
}

interface CollapsibleFieldProps {
  label: string;
  /** 畳んだままでも何が適用されるか分かる 1 行（例: 「未設定のまま登録」）。 */
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * 既定では畳んでおく入力欄（S-25 の NS・コンタクト）。
 * 開閉トリガーの見た目は直接検索（`direct-search.tsx`）、
 * 開いた・閉じたの矢印は手動設定（`manual-instructions.tsx`）に合わせる。
 */
function CollapsibleField({
  label,
  summary,
  open,
  onOpenChange,
  children,
}: CollapsibleFieldProps) {
  const panelId = useId();

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        aria-expanded={open}
        className="flex h-control-md w-full shrink-0 items-center justify-between gap-2 border-2 border-line border-solid bg-panel px-3 text-body text-ink hover:bg-hover"
        onClick={() => onOpenChange(!open)}
        type="button"
        {...(open ? { "aria-controls": panelId } : {})}
      >
        <span className="shrink-0">{label}</span>
        <span className="flex min-w-0 items-center gap-2">
          {open ? null : (
            <span className="truncate text-caption text-muted">{summary}</span>
          )}
          <span
            aria-hidden="true"
            className="inline-flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-full"
          >
            {open ? <ChevronDown /> : <ChevronRight />}
          </span>
        </span>
      </button>
      {open ? (
        <div className="flex w-full flex-col gap-2" id={panelId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface RecheckSummaryProps {
  pending: boolean;
  checkFailed: boolean;
  uniqueness: UniquenessScore | null;
}

/** 空き・スコア・レア度の 1 行。スコアを押すと類似候補 3 件の内訳を開く（ui-screens S-25）。 */
function RecheckSummary({
  pending,
  checkFailed,
  uniqueness,
}: RecheckSummaryProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  if (pending) {
    return <Skeleton className="h-6 max-w-64" />;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-wrap items-center gap-2">
        {checkFailed ? (
          <Badge tone="warn">空きを再確認できませんでした</Badge>
        ) : (
          <Badge icon={<Check />}>空き・再確認済み</Badge>
        )}
        {uniqueness === null ? null : (
          <button
            aria-controls={detailsId}
            aria-expanded={open}
            aria-label={
              open ? "独自性スコアの内訳を閉じる" : "独自性スコアの内訳を開く"
            }
            className="flex items-center gap-1.5"
            onClick={() => setOpen((prev) => !prev)}
            type="button"
          >
            <span className="text-display-score-sm text-ink">
              {uniqueness.score}
            </span>
            <span className="text-caption text-muted">/100</span>
            <Rarity tier={rarityTier(uniqueness.score)} />
            <span className="text-caption text-muted">
              {uniquenessText(uniqueness.score)}
            </span>
          </button>
        )}
      </div>
      {open && uniqueness !== null ? (
        <ul className="flex w-full flex-col gap-0.5" id={detailsId}>
          {uniqueness.nearest.map((near) => (
            <li key={near.name}>
              <SimilarityRow name={near.name} similarity={near.similarity} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
