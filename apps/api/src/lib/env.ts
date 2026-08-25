import { z } from "zod";

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

const apiEnvSchema = z.object({
  REGISTRY_MODE: z.enum(["real", "mock"]).default("mock"),
  MOCK_REGISTRY_FAIL_MODE: z
    .enum(["none", "timeout", "5xx", "reject", "spec_mismatch"])
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
