import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1).default("ドパ民.com"),
  WEBAUTHN_ORIGIN: z.url(),
});

export type ApiEnv = z.infer<typeof envSchema>;

let cached: ApiEnv | undefined;

/**
 * 環境変数の検証（FR-01 spec §6, NFR-05）。
 * モジュール読み込み時ではなく、最初に必要になった時点で検証する
 * （health など環境変数不要なルートを env 未設定でも動かせるようにするため）。
 */
export function env(): ApiEnv {
  cached ??= envSchema.parse(process.env);
  return cached;
}
