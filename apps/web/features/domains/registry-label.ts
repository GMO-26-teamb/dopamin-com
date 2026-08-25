import type { RegistryId } from "@dopamin/shared";

/**
 * レジストリ ID の表示名。画面には raw の id（`kitaqsign` など）を出さず、必ずこれを通す。
 * ダッシュボード / ドメインカード / 詳細 / 検索結果で共通。
 */
export const REGISTRY_LABEL: Record<RegistryId, string> = {
  kitaqsign: "Kitaqsign",
  kitaqnic: "Kitaqnic",
  mock: "モックレジストリ",
};

/** 初めての人向けの補足。「レジストリ」という言葉自体を説明する */
export const REGISTRY_HELP =
  "ドメインの台帳を管理している事業者です。ドパ民.com はここに登録・更新を依頼します。";
