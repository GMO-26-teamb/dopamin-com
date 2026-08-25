"use client";

/**
 * Figma: S-00 `80:2` の右カラム（`docs/ui-design/10-landing-standard.png`）。
 * ランディングの「お試しスコア」。
 *
 * ui-screens §7-1（要確認）: 独自性スコアの API（`POST /domains/check`）は認証必須で、
 * 未認証で呼べる口がまだ決まっていない。仮置きとして
 * - 入力欄の横に「ログイン後に利用可」と注記する
 * - 実 API を叩く http モードでは入力欄と実行ボタンを Disabled にする
 * とし、モックモードでは動かして体験を確認できるようにしている
 * （fe-ui 設計 §1「モックで全画面」）。§7-1 が決まったらここだけ直す。
 */

import {
  domainNameSchema,
  rarityTier,
  sldSchema,
  uniquenessLabel,
} from "@dopamin/shared";
import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { Input } from "@/components/ui/input";
import { Rarity } from "@/components/ui/rarity";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { SimilarityRow } from "@/components/ui/similarity-row";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiClientError } from "@/lib/api/errors";
import { useCheckDomains } from "@/lib/api/hooks";
import { API_MODE } from "@/lib/api/mode";
import type { SearchResult } from "@/lib/api/types";

/** 直接 FQDN を書かなかったときに試す TLD。 */
const DEFAULT_TLD = "com";

/** 類似候補は上位 3 件まで（Figma と同じ）。 */
const NEAREST_LIMIT = 3;

const INVALID_INPUT =
  "英数字とハイフンで入力してください（例: takutaku / takutaku.com）。";

/** 「gogle」なら `{ sld, tlds }`、「gogle.com」なら `{ names }` に振り分ける。 */
function toCheckRequest(raw: string) {
  const value = raw.trim().toLowerCase();
  if (value === "") {
    return null;
  }
  if (value.includes(".")) {
    const parsed = domainNameSchema.safeParse(value);
    return parsed.success ? { names: [parsed.data] } : null;
  }
  const parsed = sldSchema.safeParse(value);
  return parsed.success ? { sld: parsed.data, tlds: [DEFAULT_TLD] } : null;
}

export function TrialScore() {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const check = useCheckDomains();

  // §7-1 が決まるまで、実 API を叩くモードでは操作させない
  const enabled = API_MODE !== "http";
  const result = check.data?.[0] ?? null;

  const run = () => {
    const request = toCheckRequest(value);
    if (request === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    check.mutate(request);
  };

  return (
    <section className="flex flex-col justify-center gap-3 px-8 py-10">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-caption text-muted" htmlFor={inputId}>
          ためしてみる
        </label>
        <span className="text-caption text-muted">ログイン後に利用可</span>
      </div>

      <form
        className="flex items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            disabled={!enabled}
            error={invalid ? INVALID_INPUT : undefined}
            id={inputId}
            name="trial"
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
            placeholder="gogle"
            value={value}
          />
        </div>
        <Button
          disabled={!enabled}
          leadingIcon={<Search />}
          loading={check.isPending}
          type="submit"
          variant="solid"
        >
          {check.isPending ? "確認中…" : "スコアを見る"}
        </Button>
      </form>

      <TrialResult
        error={check.error}
        isPending={check.isPending}
        onRetry={run}
        result={result}
      />

      <p className="text-caption text-muted">
        ↑ 有名サービスに似た名前は正直に低スコア。あなたの候補は?
      </p>
    </section>
  );
}

function TrialResult({
  isPending,
  error,
  result,
  onRetry,
}: {
  isPending: boolean;
  error: ApiClientError | null;
  result: SearchResult | null;
  onRetry: () => void;
}) {
  if (isPending) {
    return (
      <Card>
        <div className="flex items-center gap-4">
          <Skeleton className="h-15 w-26" shape="card" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="w-24" />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </div>
      </Card>
    );
  }

  if (error !== null) {
    return <ErrorCard error={error} onRetry={onRetry} />;
  }

  if (result === null) {
    return null;
  }

  const uniqueness = result.uniqueness;
  if (uniqueness === null) {
    return (
      <Card emphasis="muted">
        <p className="text-body-sm text-muted">
          このドメインの独自性スコアは取得できませんでした。
        </p>
      </Card>
    );
  }

  const tier = rarityTier(uniqueness.score);
  const low = uniquenessLabel(uniqueness.score) === "low";

  return (
    <Card emphasis={low ? "warn" : "default"}>
      <div className="flex items-center gap-4">
        <ScoreGauge tone={low ? "warn" : "brand"} value={uniqueness.score} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Badge
            className="self-start"
            tone={low ? "warn" : tier === "SSR" ? "brand" : "neutral"}
          >
            <span className="inline-flex items-center gap-1">
              <Rarity tier={tier} />
              {low ? "紛らわしい" : null}
            </span>
          </Badge>
          {uniqueness.nearest.slice(0, NEAREST_LIMIT).map((near) => (
            <SimilarityRow
              key={near.name}
              name={near.name}
              similarity={near.similarity}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
