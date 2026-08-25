/**
 * モックのシナリオ（fe-ui 設計 §4.4 / §6）。
 * URL の `?mock=<scenario>` から解決する。不正値・未指定は `default`。
 */

export const MOCK_SCENARIOS = [
  "default",
  "empty",
  "loading",
  "error",
  "ai-timeout",
  "partial-failure",
  "stale",
  "ns-fail",
  "conflict",
  "unsupported",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

/** `?mock=` のクエリ値（`URLSearchParams#get` の戻り）をシナリオに解決する。 */
export function parseScenario(raw: string | null | undefined): MockScenario {
  if (raw == null) {
    return "default";
  }
  const normalized = raw.trim().toLowerCase();
  return (MOCK_SCENARIOS as readonly string[]).includes(normalized)
    ? (normalized as MockScenario)
    : "default";
}

/** 読み込み中（S-12 / S-21 / S-35 / S-40b）を再現するための遅延。それ以外は 400ms。 */
export function defaultDelayMs(scenario: MockScenario): number {
  return scenario === "loading" ? 10_000 : 400;
}
