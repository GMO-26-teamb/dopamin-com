import Link from "next/link";
import { TopBar } from "@/components/app/top-bar";
import { BrandBar } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { SignedInRedirect } from "@/features/auth/signed-in-redirect";
import { LandingHero } from "@/features/landing/landing-hero";
import { TrialScore } from "@/features/landing/trial-score";

/**
 * S-00（`/`、Figma `80:2`）。ランディング。
 * Top Bar + ヒーロー（→ S-01 / S-02）+ お試しスコア（ui-screens §7-1 の仮置き）。
 * ログイン済みで来た人は `/dashboard` へ送る（ui-screens §3）。
 */
export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SignedInRedirect />
      <TopBar
        action={
          <Button asChild variant="outline">
            <Link href="/login">ログイン</Link>
          </Button>
        }
      />
      <main className="relative flex flex-1 justify-center">
        {/*
          右半分の地。ページの器（max-w-page）は画面中央に寄るので、
          `right-0 w-1/2` はそのまま右カラムの始点から画面端までを覆う。
          `lg` 未満は 1 カラムに積むので出さない（#224）。
        */}
        <div
          aria-hidden="true"
          className="brand-field brand-gradient pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block"
        />
        <div className="relative grid w-full max-w-page grid-cols-1 lg:grid-cols-2">
          <LandingHero />
          <TrialScore />
        </div>
      </main>
      <BrandBar variant="rule" />
    </div>
  );
}
