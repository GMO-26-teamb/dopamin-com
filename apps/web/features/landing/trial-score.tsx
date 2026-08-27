"use client";

/**
 * Figma: S-00 `80:2` の右カラム（`docs/ui-design/10-landing-standard.png`）。
 * ランディングの「お試しスコア」。
 *
 * 独自性スコアだけを返す口（`POST /uniqueness/preview`）はログイン不要なので、
 * モック / 実 API のどちらのモードでもそのまま動く。空き確認（FR-03）はしないため、
 * ここに出るのは「既存の名前とどれくらい紛らわしいか」だけで、登録できるかは分からない。
 */

import {
  domainNameSchema,
  rarityTier,
  sldSchema,
  type UniquenessPreviewRequest,
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
import { usePreviewUniqueness } from "@/lib/api/hooks";
import type { UniquenessPreview } from "@/lib/api/types";
import { ScoreField } from "./score-field";

/** 類似候補は上位 3 件まで（Figma と同じ）。 */
const NEAREST_LIMIT = 3;

/** 入力前の右カラムを空にしないための例。押すとそのまま試せる。 */
const EXAMPLES = ["gogle", "takutaku", "amazan"] as const;

const INVALID_INPUT =
  "英数字とハイフンで入力してください（例: takutaku / takutaku.com）";

/** 「gogle」なら `{ sld }`、「gogle.com」なら `{ name }` に振り分ける。 */
function toPreviewRequest(raw: string): UniquenessPreviewRequest | null {
  const value = raw.trim().toLowerCase();
  if (value === "") {
    return null;
  }
  if (value.includes(".")) {
    const parsed = domainNameSchema.safeParse(value);
    return parsed.success ? { name: parsed.data } : null;
  }
  const parsed = sldSchema.safeParse(value);
  return parsed.success ? { sld: parsed.data } : null;
}

export function TrialScore() {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const preview = usePreviewUniqueness();

  /** 例を押したときは state の反映を待たずに走らせたいので、値を引数で受け取る。 */
  const run = (raw: string) => {
    const request = toPreviewRequest(raw);
    if (request === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    preview.mutate(request);
  };

  const tryExample = (example: string) => {
    setValue(example);
    run(example);
  };

  return (
    <section className="flex flex-col justify-center gap-4 px-6 py-10 md:px-10 lg:py-14 xl:px-14">
      <ScoreField placement="top" />

      <div className="flex flex-col gap-1">
        <label className="text-label text-ink" htmlFor={inputId}>
          ためしてみる
        </label>
        <p className="text-caption text-muted">
          ログイン不要。0〜100 で返します。
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          run(value);
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
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
          leadingIcon={<Search />}
          loading={preview.isPending}
          type="submit"
          variant="solid"
        >
          {preview.isPending ? "確認中…" : "スコアを見る"}
        </Button>
      </form>

      <TrialResult
        error={preview.error}
        isPending={preview.isPending}
        onExample={tryExample}
        onRetry={() => run(value)}
        result={preview.data ?? null}
      />

      <ScoreField placement="bottom" />
    </section>
  );
}

function TrialResult({
  isPending,
  error,
  result,
  onRetry,
  onExample,
}: {
  isPending: boolean;
  error: ApiClientError | null;
  result: UniquenessPreview | null;
  onRetry: () => void;
  onExample: (example: string) => void;
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

  // RATE_LIMITED の「あと何秒で試せるか」も含めて、文言は toErrorCopy が持つ
  if (error !== null) {
    return <ErrorCard error={error} onRetry={onRetry} />;
  }

  if (result === null) {
    return <TrialEmpty onExample={onExample} />;
  }

  return <TrialCard result={result} />;
}

/** まだ何も試していないときの右カラム。何が返るのかと、そのまま押せる例を出す。 */
function TrialEmpty({ onExample }: { onExample: (example: string) => void }) {
  return (
    <Card emphasis="muted">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted">例</span>
        {EXAMPLES.map((example) => (
          <Button
            key={example}
            onClick={() => onExample(example)}
            size="sm"
            type="button"
            variant="outline"
          >
            {example}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function TrialCard({ result }: { result: UniquenessPreview }) {
  const { uniqueness } = result;
  const tier = rarityTier(uniqueness.score);
  const low = uniquenessLabel(uniqueness.score) === "low";
  const nearest = uniqueness.nearest.slice(0, NEAREST_LIMIT);

  return (
    <Card emphasis={low ? "warn" : "default"}>
      <div className="flex items-center gap-4">
        <ScoreGauge tone={low ? "warn" : "brand"} value={uniqueness.score} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={low ? "warn" : tier === "SSR" ? "brand" : "neutral"}>
              <span className="inline-flex items-center gap-1">
                <Rarity tier={tier} />
                {low ? "紛らわしい" : null}
              </span>
            </Badge>
            <span className="min-w-0 truncate text-code text-muted">
              {result.sld}
            </span>
          </div>
          {nearest.length === 0 ? (
            <p className="text-caption text-muted">
              似ている名前は見つかりませんでした。
            </p>
          ) : (
            nearest.map((near) => (
              <SimilarityRow
                key={near.name}
                name={near.name}
                similarity={near.similarity}
              />
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
