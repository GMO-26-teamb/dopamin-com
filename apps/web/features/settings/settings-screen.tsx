"use client";

import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/api/hooks";
import { AiSettingsSection } from "./ai-settings-section";
import { DemoResetSection } from "./demo-reset-section";
import type { SettingsNotice } from "./notice";
import { PasskeySection } from "./passkey-section";
import { ThemeSection } from "./theme-section";

/**
 * S-70 設定（Figma `85:6709`）/ S-71 リセット完了（`85:6884`）。
 *
 * テーマ（FR-01）・パスキー管理（FR-01）・AI 設定（FR-17）・デモデータリセット（FR-16）。
 * 結果の帯（S-70b / S-71）はメイン先頭に 1 本だけ出す（ui-screens §4）。
 */
export function SettingsScreen() {
  const me = useMe();
  const [notice, setNotice] = useState<SettingsNotice | null>(null);

  return (
    <>
      {notice === null ? null : (
        <Banner
          onClose={() => setNotice(null)}
          title={notice.title}
          tone={notice.tone}
          {...(notice.body === undefined ? {} : { body: notice.body })}
        />
      )}
      <PageHeader title="設定" />

      {/*
        テーマとパスキーは `GET /auth/me` に依存しない。
        `settings.me()` が落ちても（HTTP モードでは NOT_IMPLEMENTED）画面が使えなくならないよう
        `me` の分岐より前に置き、`usePasskeys` も `me` を待たずに走らせる。
      */}
      <ThemeSection />
      <PasskeySection onNotify={setNotice} />

      {me.isPending ? (
        <SettingsSkeleton />
      ) : me.error ? (
        <ErrorCard
          error={me.error}
          onRetry={() => {
            void me.refetch();
          }}
          showLogsLink
        />
      ) : (
        <div className="flex w-full flex-col items-start gap-3 md:flex-row">
          <AiSettingsSection
            ai={me.data.ai}
            className="min-w-0 flex-1"
            onNotify={setNotice}
          />
          {me.data.features.demoReset ? (
            <DemoResetSection className="min-w-0 flex-1" onNotify={setNotice} />
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * `me` 待ちのあいだの骨組み（ui-screens §4）。
 * 対象は `me` に依存する AI 設定とデモリセットの 2 枚だけで、
 * パスキーカードは `PasskeySection` が自前の骨組みを出す。
 */
function SettingsSkeleton() {
  return (
    <div
      aria-busy="true"
      className="flex w-full flex-col items-start gap-3 md:flex-row"
    >
      <Card className="min-w-0 flex-1" kicker="AI 設定">
        <Skeleton shape="block" />
      </Card>
      <Card className="min-w-0 flex-1" emphasis="warn">
        <Skeleton shape="block" />
      </Card>
    </div>
  );
}
