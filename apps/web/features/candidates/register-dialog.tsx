"use client";

import { DOPAMIN_NAMESERVERS, rarityTier } from "@dopamin/shared";
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
import type { ApiClientError } from "@/lib/api/errors";
import { useCheckDomains, useRegisterDomain } from "@/lib/api/hooks";
import type { DomainDetail, UniquenessScore } from "@/lib/api/types";
import { uniquenessText } from "./labels";

/**
 * Figma: S-25 `81:1437`（Dialog / Register `53:53`）
 * ui-screens S-25。開いた直後に check を再実行して「空き・再確認済み」を出し、
 * 期間だけ選んで「登録する」。NS / コンタクトは既定値の表示のみ（あとから情報修正で変える）。
 */

/** 登録期間は 1〜10 年（domainCreateRequestSchema / AC-08-2）。 */
const PERIOD_OPTIONS: readonly SelectOption[] = Array.from(
  { length: 10 },
  (_, index) => ({ value: `${index + 1}`, label: `${index + 1} 年` }),
);

export interface RegisterTarget {
  name: string;
  uniqueness: UniquenessScore | null;
}

export interface RegisterDialogProps {
  target: RegisterTarget | null;
  /** S-28 で「登録は行われていません」と分かって戻ってきたとき（ui-screens S-28） */
  notice?: string | null;
  onOpenChange: (open: boolean) => void;
  onRegistered: (domain: DomainDetail) => void;
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
  const recheck = useCheckDomains();
  const register = useRegisterDomain();
  const name = target?.name ?? "";

  // 直前に check を再実行する（ui-screens S-25）。開くたびに 1 回だけ。
  const { mutate: runRecheck, reset: resetRecheck } = recheck;
  const { reset: resetRegister } = register;
  useEffect(() => {
    if (name === "") {
      return;
    }
    setPeriod("1");
    // 前回の失敗（Error Card）を持ち越さない
    resetRegister();
    resetRecheck();
    runRecheck({ names: [name] });
  }, [name, runRecheck, resetRecheck, resetRegister]);

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

  const handleRegister = () => {
    if (target === null) {
      return;
    }
    register.mutate(
      { name: target.name, period: Number(period) },
      {
        onSuccess: onRegistered,
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

  return (
    <FormDialog
      busy={register.isPending}
      onOpenChange={(open) => {
        if (!open) {
          register.reset();
        }
        onOpenChange(open);
      }}
      onPrimary={handleRegister}
      open={target !== null}
      primaryDisabled={!canRegister}
      primaryLabel="登録する — 決めるのはこれだけ"
      title={`${name} を登録`}
    >
      {notice === null ? null : (
        <Banner
          body="料金は発生していません。もう一度「登録する」を押せば再送できます。"
          title={notice}
          tone="info"
        />
      )}

      <RecheckSummary
        checkFailed={checkFailed}
        pending={recheck.isPending}
        uniqueness={uniqueness}
      />

      <Select
        label="期間 *"
        onValueChange={setPeriod}
        options={PERIOD_OPTIONS}
        surface="panel"
        value={period}
      />
      <Input
        disabled
        helper={`既定: ${DOPAMIN_NAMESERVERS.join(" / ")}`}
        label="ネームサーバー"
        placeholder="既定値のまま（あとから変更できます）"
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

      {otherError === null ? null : <ErrorCard error={otherError} />}

      <p className="w-full text-caption text-muted">
        成功後:「サブドメイン設計に進む」/「詳細を見る」
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
