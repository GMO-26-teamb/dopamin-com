import { redirect } from "next/navigation";

/**
 * 旧 URL の互換。パスキー管理は設定画面（S-70）に統合した（fe-ui 設計 §2）。
 */
export default function PasskeysPage(): never {
  redirect("/settings");
}
