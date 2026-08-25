import { ArrowRight, KeyRound } from "lucide-react";
import Link from "next/link";
import { BrandBar } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/card";

/**
 * Figma: S-00 `80:2` の左カラム（`docs/ui-design/10-landing-standard.png`）。
 * ヒーロー見出し + リード + 主要 CTA（→ S-01）+ 3 つの特徴。
 */

const FEATURES = [
  { title: "AIが候補を出す", body: "ニックネームから6案" },
  { title: "独自性スコア", body: "紛らわしさを0-100で" },
  { title: "サブドメイン設計", body: "リポの中身から提案" },
] as const;

export function LandingHero() {
  return (
    <section className="flex flex-col justify-center gap-4 border-line border-r-2 border-solid px-8 py-10">
      <BrandBar />
      <h1 className="text-display-hero text-ink">
        考えるのは
        <span className="bg-[image:var(--gradient-brand)] bg-clip-text text-transparent">
          楽しく、
        </span>
        <br />
        設定は考えなくていい。
      </h1>
      <p className="max-w-125 text-body-lead text-muted">
        その名前、紛らわしくない? —
        登録前に「既存と似ていないか」を数値で確かめられる、はじめての人のためのドメイン屋。
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          asChild
          leadingIcon={<KeyRound />}
          size="lg"
          trailingIcon={<ArrowRight />}
          variant="primary"
        >
          <Link href="/signup">パスキーではじめる</Link>
        </Button>
        <span className="text-caption text-muted">メール・パスワード不要</span>
      </div>
      <Divider />
      <ul className="grid grid-cols-3">
        {FEATURES.map((feature, index) => (
          <li
            className={
              index === 0
                ? "flex flex-col gap-1"
                : "flex flex-col gap-1 border-soft border-l border-solid pl-4"
            }
            key={feature.title}
          >
            <span className="text-label text-ink">{feature.title}</span>
            <span className="text-caption text-muted">{feature.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
