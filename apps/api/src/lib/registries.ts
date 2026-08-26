import {
  createRegistrySet,
  type KitaqAdapterConfig,
  type RegistryAdapter,
  type RegistryCallRecord,
  type RegistrySet,
} from "@dopamin/registry";
import { SUPPORTED_TLDS } from "@dopamin/shared";
import {
  buildOperationLogConsoleLine,
  buildOperationLogRow,
  OperationLogWriteTimeoutError,
  recordOperationLog,
} from "../services/operation-log.service";
import { getDb } from "./db";
import { type ApiEnv, getApiEnv } from "./env";
import { ApiException } from "./errors";
import { getRequestContext, nextClTrid } from "./operation-log-context";

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

/**
 * 操作ログ（FR-15）の RegistryClient ラッパー実体。アダプタが発行する
 * RegistryCallRecord を受け取り、構造化 console ログ（NFR-06、Vercel で閲覧）と
 * operation_logs への INSERT（§9.1）を行う。
 * 順序は console → INSERT: INSERT 失敗や serverless の関数フリーズでも
 * Vercel ログには必ず残す。失敗はレジストリ操作の成否に影響させない。
 */
async function handleRegistryCall(record: RegistryCallRecord): Promise<void> {
  const context = getRequestContext();
  console.log(JSON.stringify(buildOperationLogConsoleLine(record, context)));
  try {
    await recordOperationLog(getDb(), buildOperationLogRow(record, context));
  } catch (cause) {
    // drizzle の DrizzleQueryError は message に「Failed query: insert … params: <全パラメータ>」を
    // 持つため、そのまま出すとマスク済みとはいえペイロード全体が Vercel ログに載る。
    // 根本原因（ECONNREFUSED / 23502 など）は cause.cause 側にあるので、そちらを短く出す。
    const root =
      cause instanceof Error && cause.cause instanceof Error
        ? cause.cause
        : cause;
    console.error(
      JSON.stringify({
        level: "error",
        type: "operation_log_write_failed",
        requestId: context.requestId,
        registry: record.registry,
        command: record.command,
        clTrid: record.clTrid,
        reason:
          root instanceof OperationLogWriteTimeoutError ? "timeout" : "error",
        errorName: root instanceof Error ? root.name : null,
        message: (root instanceof Error ? root.message : String(root)).slice(
          0,
          300,
        ),
      }),
    );
  }
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
      // 操作ログ（FR-15）: 全レジストリ呼び出しを記録する
      onCall: handleRegistryCall,
      makeClTrid: nextClTrid,
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
    throw new ApiException("VALIDATION_ERROR", "未対応の TLD です。", {
      supportedTlds: SUPPORTED_TLDS,
    });
  }
  return adapter;
}
