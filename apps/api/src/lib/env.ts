import { AI_PROVIDERS } from "@dopamin/shared";
import { z } from "zod";
import { ApiException } from "./errors";

const authEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1).default("ドパ民.com"),
  WEBAUTHN_ORIGIN: z.url(),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

let cachedAuthEnv: AuthEnv | undefined;

/**
 * 環境変数の検証（FR-01 spec §6, NFR-05）。
 * モジュール読み込み時ではなく、最初に必要になった時点で検証する
 * （health など環境変数不要なルートを env 未設定でも動かせるようにするため）。
 */
export function env(): AuthEnv {
  cachedAuthEnv ??= authEnvSchema.parse(process.env);
  return cachedAuthEnv;
}

/** 空文字は「未設定」として扱う（.env.example の空値対策）。 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

/**
 * `"true"` の場合だけ true。それ以外（未設定・空文字・`"false"` 含む）は false。
 * `z.coerce.boolean()` は非空文字列を無条件で true にしてしまう（`"false"` も true になる）ため使わない。
 */
const booleanFlag = z
  .string()
  .optional()
  .transform((v) => v === "true");

const apiEnvSchema = z.object({
  REGISTRY_MODE: z.enum(["real", "mock"]).default("mock"),
  MOCK_REGISTRY_FAIL_MODE: z
    .enum([
      "none",
      "timeout",
      "5xx",
      "reject",
      "spec_mismatch",
      // 更新系だけを「届いたが応答が返らない」状態にする（#49。AC-18-2 の手元再現）
      "timeout_after_write",
    ])
    .default("none"),
  KITAQSIGN_BASE_URL: optionalString,
  KITAQSIGN_GATE_USER: optionalString,
  KITAQSIGN_GATE_PASSWORD: optionalString,
  KITAQSIGN_REGISTRAR_ID: optionalString,
  KITAQSIGN_API_KEY: optionalString,
  KITAQNIC_BASE_URL: optionalString,
  KITAQNIC_GATE_USER: optionalString,
  KITAQNIC_GATE_PASSWORD: optionalString,
  KITAQNIC_REGISTRAR_ID: optionalString,
  KITAQNIC_API_KEY: optionalString,

  /** マイグレーション用（5432 直結）。ランタイムでは未使用だが §17 に合わせて検証だけ行う（drizzle-kit は process.env を直接読む）。 */
  DIRECT_DATABASE_URL: optionalString,

  /** mock レジストリの相手レジストラ ID / 自動承認までのミリ秒（既定 20 分。§11 の移管シミュレーション、テストでは短縮）。 */
  MOCK_FOREIGN_REGISTRAR_ID: optionalString,
  MOCK_TRANSFER_AUTO_APPROVE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 60 * 1000),

  /**
   * 生成 AI の既定プロバイダ（§13.1）。値域は `packages/shared` の {@link AI_PROVIDERS} が正
   * （プロバイダを足したらそちらだけを直せばよい。ここで別に列挙すると、
   * shared に足したプロバイダを `AI_PROVIDER` に設定した瞬間に起動時 parse が落ちる）。
   * 既定は Google AI Studio の無料枠。`xai` は Gateway 経由専用（`docs/specs/ai-gateway.md` §2.6）。
   */
  AI_PROVIDER: z.enum(AI_PROVIDERS).default("google"),
  /** 具体的なモデル ID は運用側で決定・設定する（未設定時は AI 呼び出し側が requireEnv 等で扱う）。 */
  AI_MODEL: optionalString,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  /**
   * Vercel AI Gateway のキー。プロバイダ固有のキーを配らなくても AI を有効化できる
   * （`ai` パッケージが依存する `@ai-sdk/gateway` が同じ名前で読む値）。
   * プロバイダ固有のキーがある場合はそちらを優先し、無いときだけ gateway 経由にする。
   */
  AI_GATEWAY_API_KEY: optionalString,

  // 埋め込み（EMBEDDING_PROVIDER / EMBEDDING_MODEL）と独自性スコアの較正値
  // （UNIQUENESS_THETA_LOW / HIGH）は ADR-0003 で不採用になり、§17 の表からも外れた。
  // ラベルの境界 40 / 70 は packages/shared の uniquenessLabel が固定で持つ（§14.2）。

  /**
   * GitHub 解析（FR-13）の実接続 / フェイクの切替。既定は REGISTRY_MODE と同じく `mock` で、
   * トークンや外部通信が無い環境でも導線を通せるようにする。
   */
  GITHUB_MODE: z.enum(["real", "mock"]).default("mock"),
  /** `GITHUB_MODE=mock` のときの失敗シミュレーション（AC-13-2 の手元再現）。 */
  GITHUB_MOCK_FAIL_MODE: z
    .enum(["none", "not_found", "rate_limited", "unreachable"])
    .default("none"),
  /** 公開リポ取得のレート制限緩和（読み取りのみのスコープ）。`GITHUB_MODE=real` でも任意。 */
  GITHUB_TOKEN: optionalString,

  /** true で FR-16（デモデータリセット）を有効化する。 */
  DEMO_RESET_ENABLED: booleanFlag,

  LOG_LEVEL: z.enum(["info", "debug"]).default("info"),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

let cached: ApiEnv | null = null;

/** process.env を zod で検証して返す（NFR-05）。初回アクセス時に確定する。 */
export function getApiEnv(): ApiEnv {
  if (cached === null) {
    cached = apiEnvSchema.parse(process.env);
  }
  return cached;
}

/**
 * テスト専用: キャッシュされた env を破棄する。次回アクセス時に process.env から再構築させる。
 * 本番コードからは呼ばない。
 */
export function resetApiEnvCacheForTesting(): void {
  cached = null;
}

/**
 * オプショナルな文字列系の環境変数を取得し、未設定（空文字含む）なら 500 INTERNAL を投げる。
 * `GITHUB_TOKEN` のように「機能を使うときだけ必須」な値に使う（NFR-05）。
 */
export function requireEnv<K extends keyof ApiEnv>(key: K): string {
  const value = getApiEnv()[key];
  if (typeof value !== "string" || value === "") {
    throw new ApiException("INTERNAL", `環境変数 ${key} が未設定です。`);
  }
  return value;
}
