import type { ApiClientError } from "@/lib/api/errors";

/**
 * 設定画面のメイン先頭に出す 1 本の面（ui-screens §4「成功 → Banner Ok」/ S-70b / S-71）。
 * 各セクションは自分で Banner も Error Card も持たず、これを親（`SettingsScreen`）に投げる。
 * 警告の面が縦に積み重ならないよう、同時に出るのは常に 1 本だけにする。
 *
 * - `banner`: 成功と、詳細の要らない失敗（WebAuthn のキャンセルなど）
 * - `error`: 更新系の失敗。code / HTTP / request ID まで出す（ui-screens §4）
 */
export type SettingsNotice =
  | { kind: "banner"; tone: "ok" | "warn"; title: string; body?: string }
  | { kind: "error"; error: ApiClientError };

/** `null` を渡すと今出ている面を消す（別の操作を始めるとき） */
export type NotifySettings = (notice: SettingsNotice | null) => void;
