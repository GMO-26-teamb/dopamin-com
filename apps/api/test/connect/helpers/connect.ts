import { fileURLToPath } from "node:url";
import type { KitaqAdapterConfig } from "@dopamin/registry";

/**
 * apps/api/.env.local を読み込む（無ければ何もしない）。
 * 既に設定済みの環境変数は上書きされない（`node --env-file` と同じ挙動）。
 */
export function loadEnvLocal(): void {
  try {
    process.loadEnvFile(
      fileURLToPath(new URL("../../../.env.local", import.meta.url)),
    );
  } catch {
    // .env.local が無い環境（CI など）ではスキップし、ガード側で skip させる
  }
}

/**
 * 実レジストリ疎通テストは明示的に要求されたときだけ実行する。
 * 更新系コマンドが実データに反映されるため、通常の `pnpm test` では動かさない。
 * 実行方法は docs/testing.md を参照。
 */
export function connectTestRequested(): boolean {
  return process.env.REGISTRY_CONNECT_TEST === "1";
}

const ENV_PREFIX = { kitaqsign: "KITAQSIGN", kitaqnic: "KITAQNIC" } as const;

/** .env.local の KITAQSIGN_* / KITAQNIC_* からアダプタ設定を組み立てる。欠けていれば null。 */
export function kitaqConfigFromEnv(
  id: keyof typeof ENV_PREFIX,
): KitaqAdapterConfig | null {
  const prefix = ENV_PREFIX[id];
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const gateUser = process.env[`${prefix}_GATE_USER`];
  const gatePassword = process.env[`${prefix}_GATE_PASSWORD`];
  const registrarId = process.env[`${prefix}_REGISTRAR_ID`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  if (!baseUrl || !gateUser || !gatePassword || !registrarId || !apiKey) {
    return null;
  }
  return { id, baseUrl, gateUser, gatePassword, registrarId, apiKey };
}

/**
 * 実行ごとに一意なテスト用ドメイン名を生成する。
 * 実レジストリに実際に登録されるため、`dopamin-t` プレフィクスで識別できるようにする。
 */
export function uniqueDomainName(tld: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `dopamin-t${stamp}${rand}.${tld}`;
}
