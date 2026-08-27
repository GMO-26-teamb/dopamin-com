/**
 * EPP ステータスの日本語ラベルと説明（docs/requirements.md §11.3、ui-screens §5）。
 *
 * 「専門用語（EPP ステータス・RGP・AuthCode）はバッジに日本語ラベル + ツールチップで英語名」
 * という規則に従い、バッジは日本語、ツールチップに英語名と 1 文の説明を出す。
 * 表に無いステータスはそのまま英語名を出す（レジストリ仕様変更で増えても落とさない）。
 */

import type { BadgeProps } from "@/components/ui/badge";

export interface EppStatusCopy {
  /** バッジに出す日本語ラベル。 */
  label: string;
  /** ツールチップの説明（英語名は呼び出し側が併記する）。 */
  description: string;
  tone: NonNullable<BadgeProps["tone"]>;
}

const COPY: Record<string, EppStatusCopy> = {
  ok: {
    label: "正常",
    description: "制約はありません。",
    tone: "ok",
  },
  inactive: {
    label: "NS 未設定",
    description: "ネームサーバーが未設定で、名前解決されません。",
    tone: "neutral",
  },
  clientHold: {
    label: "停止中（レジストラ）",
    description: "レジストラが保留にしているため名前解決されません。",
    tone: "warn",
  },
  serverHold: {
    label: "停止中（レジストリ）",
    description: "レジストリが保留にしているため名前解決されません。",
    tone: "warn",
  },
  clientTransferProhibited: {
    label: "移管ロック（レジストラ）",
    description: "移管 OUT ができません。情報修正から解除できます。",
    tone: "neutral",
  },
  serverTransferProhibited: {
    label: "移管ロック（レジストリ）",
    description:
      "移管 OUT ができません。解除にはレジストリ運営への依頼が必要です。",
    tone: "warn",
  },
  clientUpdateProhibited: {
    label: "情報修正ロック（レジストラ）",
    description: "情報修正ができません。ロック解除だけは実行できます。",
    tone: "neutral",
  },
  serverUpdateProhibited: {
    label: "情報修正ロック（レジストリ）",
    description:
      "情報修正ができません。解除にはレジストリ運営への依頼が必要です。",
    tone: "warn",
  },
  clientDeleteProhibited: {
    label: "削除ロック（レジストラ）",
    description: "廃止ができません。情報修正から解除できます。",
    tone: "neutral",
  },
  serverDeleteProhibited: {
    label: "削除ロック（レジストリ）",
    description: "廃止ができません。解除にはレジストリ運営への依頼が必要です。",
    tone: "warn",
  },
  clientRenewProhibited: {
    label: "更新ロック（レジストラ）",
    description: "有効期限を更新できません。情報修正から解除できます。",
    tone: "neutral",
  },
  serverRenewProhibited: {
    label: "更新ロック（レジストリ）",
    description:
      "有効期限を更新できません。解除にはレジストリ運営への依頼が必要です。",
    tone: "warn",
  },
  pendingTransfer: {
    label: "移管中",
    description:
      "移管申請の処理中です。更新・情報修正・廃止・復旧はできません。",
    tone: "brand",
  },
  pendingDelete: {
    label: "削除待ち",
    description: "完全削除の処理中です。すべての操作ができません。",
    tone: "warn",
  },
  redemptionPeriod: {
    label: "復旧猶予（RGP）",
    description: "削除後の猶予期間です。復旧のみ実行できます。",
    tone: "warn",
  },
  pendingRestore: {
    label: "復旧処理中",
    description: "復旧の申請をレジストリが処理しています。",
    tone: "brand",
  },
  addPeriod: {
    label: "登録直後（Add GP）",
    description: "登録から 5 日以内です。廃止は無課金の取消扱いになります。",
    tone: "muted",
  },
  renewPeriod: {
    label: "更新直後（Renew GP）",
    description: "更新から 5 日以内です。表示のみで制約はありません。",
    tone: "muted",
  },
  transferPeriod: {
    label: "移管直後（Transfer GP）",
    description: "移管から 5 日以内です。表示のみで制約はありません。",
    tone: "muted",
  },
  autoRenewPeriod: {
    label: "自動更新猶予",
    description: "自動更新後の猶予期間です。表示のみで制約はありません。",
    tone: "muted",
  },
};

/** 表に無いステータスは英語名をそのまま出す（NFR-07: 仕様変更で落とさない）。 */
export function eppStatusCopy(status: string): EppStatusCopy {
  return (
    COPY[status] ?? {
      label: status,
      description: "このステータスの説明は登録されていません。",
      tone: "muted",
    }
  );
}
