"use client";

import { formatJpy, quoteOrder, rarityTier } from "@dopamin/shared";
import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { FormDialog } from "@/components/ui/dialog";
import { ErrorCard } from "@/components/ui/error-card";
import { Input } from "@/components/ui/input";
import { Rarity } from "@/components/ui/rarity";
import { Select, type SelectOption } from "@/components/ui/select";
import { SimilarityRow } from "@/components/ui/similarity-row";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentStep } from "@/features/billing/payment-step";
import { usePaymentStep } from "@/features/billing/use-payment-step";
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
 * 期間だけ選んで「お支払いへ」→ お支払いステップ（S-29、モック決済）→ 決済成功で
 * `POST /domains`。NS は送らない（レジストリ既定 = 実質未設定）ので欄は説明だけ、
 * コンタクトは登録者プロファイルを自動適用。どちらもあとから情報修正で変える（#173）。
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

  const handlePrimary = async () => {
    if (target === null || quote === null) {
      return;
    }
    if (step === "form") {
      setStep("payment");
      return;
    }
    // お支払い（S-29）: 入力検証 → 決済モック → 成功したときだけ create
    const receipt = await payment.pay(quote);
    if (receipt === null) {
      return;
    }
    register.mutate(
      { name: target.name, period: Number(period) },
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
      subtitle={
        isPayment ? "お支払い（モック決済・実際の請求はありません）" : undefined
      }
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
                : `お支払い合計 ${formatJpy(quote.total)}（税込・固定ダミー価格）`
            }
            label="期間 *"
            onValueChange={setPeriod}
            options={PERIOD_OPTIONS}
            surface="panel"
            value={period}
          />
          <Input
            disabled
            helper="登録時は未設定。あとから「情報修正」で設定できます"
            label="ネームサーバー"
            placeholder="未設定のまま登録します"
            readOnly
            surface="panel"
            value=""
          />
          <Input
            disabled
            label="コンタクト"
            placeholder="登録者プロファイルを自動適用"
            readOnly
            surface="panel"
            value=""
          />
        </>
      )}

      {otherError === null ? null : <ErrorCard error={otherError} />}

      <p className="w-full text-caption text-muted">
        {isPayment
          ? "成功後:「サブドメイン設計に進む」/「詳細を見る」"
          : "次のステップでお支払い（モック）に進みます"}
      </p>
    </FormDialog>
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
