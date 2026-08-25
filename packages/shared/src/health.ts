import { z } from "zod";
import { registryIdSchema } from "./registry";

/** レジストリごとの疎通結果（`hello` の成否）。 */
export const registryHealthSchema = z.object({
  id: registryIdSchema,
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type RegistryHealth = z.infer<typeof registryHealthSchema>;

/** `GET /health` のレスポンス。API 自体が生きていれば status は "ok"（レジストリ障害は registries に出る）。 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  registries: z.array(registryHealthSchema),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
