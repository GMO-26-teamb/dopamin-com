"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { DomainDetail } from "@/lib/api/types";
import { formatRelativeTime, remainingDays } from "../format";
import { gracePeriodOf } from "./derive";

/**
 * 状態バナー（ui-screens S-31〜S-39）。メイン先頭に **1 つだけ** 出す（§1）。
 *
 * 優先順位: 操作の成功（Banner Ok）> キャッシュ表示（S-31）> displayStatus 由来
 * > コンタクト未移行（S-39）。Active でコンタクトも移行済みなら何も出さない（S-30）。
 */
export interface StateBannerProps {
  domain: DomainDetail;
  now: number;
  /** 直近の操作が成功したときの文言（Banner Ok）。 */
  success: string | null;
  onDismissSuccess: () => void;
  /** S-32 のカウントダウン（`mm:ss`）。 */
  countdownLabel: string;
  /** S-38 / S-39 の CTA（情報修正ダイアログを開く）。 */
  onEditInfo: () => void;
}

export function StateBanner({
  domain,
  now,
  success,
  onDismissSuccess,
  countdownLabel,
  onEditInfo,
}: StateBannerProps) {
  if (success !== null) {
    return <Banner onClose={onDismissSuccess} title={success} tone="ok" />;
  }

  // S-31: info 失敗（AC-07-2）。キャッシュを出しつつ操作を止める
  if (domain.stale) {
    return (
      <Banner
        body={`表示しているのは最終同期 ${formatRelativeTime(domain.syncedAt, now)} のキャッシュです。「再同期」に成功するまで操作は実行できません。`}
        title="最新の状態を取得できませんでした"
        tone="warn"
      />
    );
  }

  switch (domain.displayStatus) {
    // S-32: 移管申請を受信（AC-07-3）
    case "transfer_out_pending":
      return (
        <Banner
          body={`承認しないと ${countdownLabel} 後に自動承認されます。承認すると所有権が移り、保有一覧から消えます。`}
          title="相手レジストラから移管申請を受信しました"
          tone="warn"
        />
      );
    // S-33: 復旧猶予（RGP）
    case "rgp":
      return (
        <Banner
          body={`残り ${remainingDays(domain.rgpUntil, now)} 日。期間内なら「復旧する」で Active に戻せます。過ぎると完全に削除されます。`}
          title="復旧猶予（RGP）期間中です"
          tone="info"
        />
      );
    // S-34: 移管済み（AC-12-5）
    case "transferred_out":
      return (
        <Banner
          body="このドメインは相手レジストラへ移管済みです。記録として表示しています。"
          title="表示のみ"
          tone="info"
        />
      );
    // S-36: 削除待ち（復旧ボタンは出さない・AC-11-2）
    case "pending_delete": {
      const until = gracePeriodOf(domain, "pendingDelete");
      const days = until === null ? null : remainingDays(until.until, now);
      return (
        <Banner
          body="レジストリが削除処理中です。復旧はできません。"
          title={
            days === null
              ? "完全削除の処理中です"
              : `完全削除まで残り ${days} 日`
          }
          tone="warn"
        />
      );
    }
    // S-37: 停止中（clientHold / serverHold）
    case "hold":
      return (
        <Banner
          body="更新・情報修正は実行できます。解除の条件は運営の案内を確認してください。"
          title="名前解決されません。運営の案内を確認"
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
          body="ネームサーバーが未設定のため、このドメインは名前解決されません。"
          title="ネームサーバーを設定してください"
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
        body="移管の取り込み後に登録者プロファイルへの差し替えができていません。「情報修正」から再実行してください。"
        title="登録者情報が旧レジストラのままです"
        tone="warn"
      />
    );
  }

  return null;
}
