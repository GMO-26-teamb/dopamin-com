/**
 * 設定画面のメイン先頭に出す 1 本の帯（ui-screens §4「成功 → Banner Ok」/ S-70b / S-71）。
 * 各セクションは自分で Banner を持たず、これを親（`SettingsScreen`）に投げる。
 */
export interface SettingsNotice {
  tone: "ok" | "warn";
  title: string;
  body?: string;
}

export type NotifySettings = (notice: SettingsNotice) => void;
