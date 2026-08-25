/**
 * データ取得の実装モード（fe-ui 設計 §4.4）。
 *
 * `NEXT_PUBLIC_API_MODE` の解決をここ 1 か所に閉じる。
 * - `http`   … 実 API（同一オリジンの `/api/v1/*` を Hono RPC で叩く）
 * - `mock` / 未設定 … モック（既定）
 * - それ以外 … 読み込み時に例外。綴り違い（`HTTP` / `mocks` など）が黙ってモックに落ちると、
 *   認証チェック（`proxy.ts`）まで素通しになってしまうため、fail open させない。
 */

export type ApiMode = "mock" | "http";

/** 環境変数の生値をモードに解決する（不正値は例外）。 */
export function resolveApiMode(raw: string | undefined): ApiMode {
  if (raw === undefined || raw === "" || raw === "mock") {
    return "mock";
  }
  if (raw === "http") {
    return "http";
  }
  throw new Error(
    `NEXT_PUBLIC_API_MODE は "mock" か "http"（未設定なら "mock"）にしてください。受け取った値: ${JSON.stringify(raw)}`,
  );
}

/**
 * 解決済みのモード。
 * `process.env.NEXT_PUBLIC_API_MODE` はビルド時に静的置換されるので、式を分割しない。
 */
export const API_MODE: ApiMode = resolveApiMode(
  process.env.NEXT_PUBLIC_API_MODE,
);
