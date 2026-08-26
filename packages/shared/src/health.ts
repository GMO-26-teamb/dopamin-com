import { z } from "zod";
import { registryIdSchema } from "./registry";

/** レジストリごとの疎通結果（`hello` の成否）。 */
export const registryHealthSchema = z.object({
  id: registryIdSchema,
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
  /**
   * アダプタが対象にしているレジストリ仕様のバージョン（`RegistryAdapter.specVersion`）。
   * Swagger のバージョンまたは取得日。仕様変更の検知（§11.5 手順 4）で、
   * デプロイ中のコードがどの仕様を前提にしているかを外から確認するために出す。
   */
  specVersion: z.string(),
});
export type RegistryHealth = z.infer<typeof registryHealthSchema>;

/**
 * DB（Supabase Postgres）の接続結果。
 * 接続先が未設定・到達不能でも `/health` 自体は 200 で返し、ここに理由を載せる
 * （疎通確認のエンドポイントが環境不備で落ちると、何が壊れているか分からなくなる）。
 */
export const dbHealthSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  /** 失敗した理由の短い分類。詳細（接続文字列など）は載せない。 */
  error: z.string().optional(),
});
export type DbHealth = z.infer<typeof dbHealthSchema>;

/**
 * `GET /health` のレスポンス（docs/requirements.md §10.1）。
 * API 自体が生きていれば status は "ok"（レジストリ・DB の障害は個別の項目に出る）。
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  registries: z.array(registryHealthSchema),
  db: dbHealthSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
