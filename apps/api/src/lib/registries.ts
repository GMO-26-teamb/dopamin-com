import {
  createRegistrySet,
  type KitaqAdapterConfig,
  type RegistryAdapter,
  type RegistrySet,
} from "@dopamin/registry";
import { SUPPORTED_TLDS } from "@dopamin/shared";
import { ApiError } from "./api-error";
import { type ApiEnv, getApiEnv } from "./env";

function kitaqConfig(
  env: ApiEnv,
  id: "kitaqsign" | "kitaqnic",
): KitaqAdapterConfig | null {
  const { baseUrl, gateUser, gatePassword, registrarId, apiKey } =
    id === "kitaqsign"
      ? {
          baseUrl: env.KITAQSIGN_BASE_URL,
          gateUser: env.KITAQSIGN_GATE_USER,
          gatePassword: env.KITAQSIGN_GATE_PASSWORD,
          registrarId: env.KITAQSIGN_REGISTRAR_ID,
          apiKey: env.KITAQSIGN_API_KEY,
        }
      : {
          baseUrl: env.KITAQNIC_BASE_URL,
          gateUser: env.KITAQNIC_GATE_USER,
          gatePassword: env.KITAQNIC_GATE_PASSWORD,
          registrarId: env.KITAQNIC_REGISTRAR_ID,
          apiKey: env.KITAQNIC_API_KEY,
        };
  if (!baseUrl || !gateUser || !gatePassword || !registrarId || !apiKey) {
    return null;
  }
  return { id, baseUrl, gateUser, gatePassword, registrarId, apiKey };
}

let cached: RegistrySet | null = null;

/** 環境変数からレジストリアダプタ集合を組み立てる（プロセス内で 1 度だけ）。 */
export function getRegistrySet(): RegistrySet {
  if (cached === null) {
    const env = getApiEnv();
    cached = createRegistrySet({
      mode: env.REGISTRY_MODE,
      kitaqsign: kitaqConfig(env, "kitaqsign"),
      kitaqnic: kitaqConfig(env, "kitaqnic"),
      mockFailMode: env.MOCK_REGISTRY_FAIL_MODE,
    });
  }
  return cached;
}

/**
 * テスト専用: アダプタ集合を差し替える。null でキャッシュを破棄し、
 * 次回アクセス時に環境変数から再構築させる。本番コードからは呼ばない。
 */
export function setRegistrySetForTesting(set: RegistrySet | null): void {
  cached = set;
}

/** FQDN からアダプタを引く。未対応 TLD は VALIDATION_ERROR。 */
export function adapterForDomain(name: string): RegistryAdapter {
  const adapter = getRegistrySet().forDomain(name);
  if (!adapter) {
    throw new ApiError(400, "VALIDATION_ERROR", "未対応の TLD です。", {
      supportedTlds: SUPPORTED_TLDS,
    });
  }
  return adapter;
}
