import { splitDomainName } from "@dopamin/shared";
import type { RegistryAdapter } from "./adapter";
import { RegistryError } from "./errors";
import type { KitaqAdapterConfig } from "./http";
import { createKitaqAdapter } from "./kitaq";
import { type MockFailMode, MockRegistryAdapter } from "./mock";
import { registryIdForTld, SUPPORTED_TLDS } from "./routing";

export type RegistryMode = "real" | "mock";

export interface RegistrySetConfig {
  mode: RegistryMode;
  /** mode=real のときに必須。欠けているレジストリへのルーティングは実行時エラーになる。 */
  kitaqsign?: KitaqAdapterConfig | null;
  kitaqnic?: KitaqAdapterConfig | null;
  /** mode=mock のときのエラーシミュレーション。 */
  mockFailMode?: MockFailMode;
  /**
   * テスト用: 構築済みアダプタを id で登録し、mode による構築を行わない。
   * TLD ルーティングを効かせるには mode: "real" と、kitaqsign / kitaqnic を
   * 名乗るアダプタ（MockRegistryAdapter の id オプション等）を組み合わせる。
   */
  adapters?: readonly RegistryAdapter[];
}

/**
 * TLD ルーティング込みのアダプタ集合。
 * mode=mock では全 TLD を単一の MockRegistryAdapter に割り当てる。
 */
export class RegistrySet {
  private readonly adapters = new Map<string, RegistryAdapter>();
  private readonly mode: RegistryMode;

  constructor(config: RegistrySetConfig) {
    this.mode = config.mode;
    if (config.adapters) {
      for (const adapter of config.adapters) {
        this.adapters.set(adapter.id, adapter);
      }
      return;
    }
    if (config.mode === "mock") {
      this.adapters.set(
        "mock",
        new MockRegistryAdapter({ failMode: config.mockFailMode }),
      );
      return;
    }
    if (config.kitaqsign) {
      this.adapters.set("kitaqsign", createKitaqAdapter(config.kitaqsign));
    }
    if (config.kitaqnic) {
      this.adapters.set("kitaqnic", createKitaqAdapter(config.kitaqnic));
    }
  }

  /** 登録済みの全アダプタ（/health の疎通確認用）。 */
  all(): RegistryAdapter[] {
    return [...this.adapters.values()];
  }

  /** TLD からアダプタを引く。未対応 TLD は null。 */
  forTld(tld: string): RegistryAdapter | null {
    const registryId = registryIdForTld(tld);
    if (registryId === null) {
      return null;
    }
    if (this.mode === "mock") {
      return this.adapters.get("mock") ?? null;
    }
    const adapter = this.adapters.get(registryId);
    if (!adapter) {
      throw new RegistryError({
        code: "REGISTRY_UNAVAILABLE",
        registry: registryId,
        message: `${registryId} の認証情報が設定されていません（環境変数を確認してください）`,
      });
    }
    return adapter;
  }

  /** FQDN からアダプタを引く。未対応 TLD は null。 */
  forDomain(name: string): RegistryAdapter | null {
    return this.forTld(splitDomainName(name).tld);
  }

  /** 対応 TLD 一覧（UI の選択肢生成用）。 */
  supportedTlds(): readonly string[] {
    return SUPPORTED_TLDS;
  }
}

export function createRegistrySet(config: RegistrySetConfig): RegistrySet {
  return new RegistrySet(config);
}
