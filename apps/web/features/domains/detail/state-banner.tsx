"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { DomainDetail } from "@/lib/api/types";
import { daysUntil, formatRelativeTime } from "../format";
import { gracePeriodOf } from "./derive";

/**
 * 状態バナー（ui-screens S-31〜S-39）。メイン先頭に **1 つだけ** 出す（§1）。
 *
 * 優先順位: 操作の成功（Banner Ok）> キャッシュ表示（S-31）> displayStatus 由来
 * > コンタクト未移行（S-39）。Active でコンタクトも移行済みなら何も出さない（S-30）。
 *
 * 文の作り方は全 Banner で揃える: **タイトルは短い名詞句**（いまどの状態か）、
 * **本文は次の一手**（何をすればいいか）。残日数はここだけに出す（ヘッダーのバッジと
 * 基本情報カードには出さない）。
 */
export interface StateBannerProps {
  domain: DomainDetail;
  now: number;
  /** 直近の操作が成功したときの文言（Banner Ok）。 */
  success: string | null;
  onDismissSuccess: () => void;
  /** S-38 / S-39 の CTA（情報修正ダイアログを開く）。 */
  onEditInfo: () => void;
}

/**
 * 「残り n 日。」。期限が分からないときは空文字（#211）。
 * `rgpUntil` はレジストリが猶予期限を返さない限り null なので、
 * `remainingDays` に渡して 0 に丸めると「残り 0 日」と断定してしまう。
 */
function remainingSentence(until: string | null, now: number): string {
  const days = daysUntil(until, now);
  return days === null || days < 0 ? "" : `残り ${days} 日。`;
}

export function StateBanner({
  domain,
  now,
  success,
  onDismissSuccess,
  onEditInfo,
}: StateBannerProps) {
  if (success !== null) {
    return <Banner onClose={onDismissSuccess} title={success} tone="ok" />;
  }

  // S-31: info 失敗（AC-07-2）。キャッシュを出しつつ操作を止める
  if (domain.stale) {
    return (
      <Banner
        body={`最終同期 ${formatRelativeTime(domain.syncedAt, now)} の内容です。「再同期」に成功すると操作できます。`}
        title="キャッシュを表示中"
        tone="warn"
      />
    );
  }

  switch (domain.displayStatus) {
    // S-32: 移管申請を受信（AC-07-3）。残り時間は操作パネル（ボタンの隣）に出す
    case "transfer_out_pending":
      return (
        <Banner
          body="「承認」すると所有権が移り、保有一覧から消えます。応答しないと自動で承認されます。"
          title="移管申請を受信"
          tone="warn"
        />
      );
    // S-33: 復旧猶予（RGP）
    case "rgp":
      return (
        <Banner
          body={`${remainingSentence(domain.rgpUntil, now)}「復旧」で Active に戻せます。期間を過ぎると完全に削除されます。`}
          title="復旧猶予（RGP）中"
          tone="info"
        />
      );
    // S-34: 移管済み（AC-12-5）
    case "transferred_out":
      return (
        <Banner
          body="相手レジストラへ移管済みのため、操作はできません。"
          title="記録として表示中"
          tone="info"
        />
      );
    // S-36: 削除待ち（復旧ボタンは出さない・AC-11-2）
    case "pending_delete": {
      const until = gracePeriodOf(domain, "pendingDelete");
      return (
        <Banner
          body={`${remainingSentence(until?.until ?? null, now)}レジストリが削除処理中です。復旧はできません。`}
          title="完全削除の処理中"
          tone="warn"
        />
      );
    }
    // S-37: 停止中（clientHold / serverHold）
    case "hold":
      return (
        <Banner
          body="更新・情報修正は実行できます。解除の条件は運営の案内を確認してください。"
          title="停止中（名前解決されません）"
          tone="warn"
        />
      );
    // S-38: NS 未設定（inactive）
    case "inactive":
      return (
        <Banner
          action={
            <Button onClick={onEditInfo} size="sm" variant="outline">
              NS を設定
            </Button>
          }
          body="設定するまでこのドメインは名前解決されません。"
          title="ネームサーバー未設定"
          tone="info"
        />
      );
    default:
      break;
  }

  // S-39: コンタクト未移行（移管 IN 後。要確認 #14 が解決するまでの暫定表示）
  if (!domain.registrant.migrated) {
    return (
      <Banner
        action={
          <Button onClick={onEditInfo} size="sm" variant="outline">
            情報修正
          </Button>
        }
        body="「情報修正」から登録者を設定し直してください。"
        title="登録者情報が未移行"
        tone="warn"
      />
    );
  }

  return null;
}
