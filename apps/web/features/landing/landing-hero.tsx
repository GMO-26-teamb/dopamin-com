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
  { title: "AI が候補を出す", body: "ニックネームから 6 案" },
  { title: "独自性スコア", body: "紛らわしさを 0〜100 で" },
  { title: "サブドメイン設計", body: "リポの中身から提案" },
] as const;

export function LandingHero() {
  return (
    <section className="flex flex-col justify-center gap-5 border-line border-b-2 border-solid px-6 py-10 md:px-10 lg:border-r-2 lg:border-b-0 lg:py-14 xl:px-14">
      <BrandBar />
      <h1 className="text-heading-page text-ink sm:text-display-hero">
        考えるのは
        <span className="brand-text">楽しく、</span>
        <br />
        設定は考えなくていい。
      </h1>
      <p className="max-w-140 text-body-lead text-muted">
        その名前、紛らわしくない？ —
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
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-0">
        {FEATURES.map((feature, index) => (
          <li
            className={
              index === 0
                ? "flex flex-col gap-1"
                : "flex flex-col gap-1 border-soft border-solid sm:border-l sm:pl-4"
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
