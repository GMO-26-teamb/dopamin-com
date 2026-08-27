import { splitDomainName } from "./domain-name";
import type { RegistryId } from "./registry";

/**
 * TLD → レジストリのルーティング表（docs/requirements.md §11.2）。
 * `GET /sessions/hello` で確定済み（2026-08-25）。両者に重複は無い。
 * 2026-08-27 の仕様変更で `.org` / `.info` の管轄が kitaqsign → kitaqnic に移管された
 * （`docs/registry/kitaqnic/CHANGELOG.md`）。
 *
 * 対応 TLD の定数はここが正。`packages/registry` のルーティングも `apps/web` の
 * TLD 選択肢もこの表を参照する（`@dopamin/registry` は `node:crypto` に依存する
 * アダプタを同じエントリから export しているためブラウザバンドルに載せられない）。
 */
export const REGISTRY_TLDS: Record<
  Exclude<RegistryId, "mock">,
  readonly string[]
> = {
  kitaqsign: ["com", "net"],
  kitaqnic: [
    // 2026-08-27 に kitaqsign から移管。UI の並び（SUPPORTED_TLDS）を保つため先頭に置く
    "org",
    "info",
    "xyz",
    "online",
    "site",
    "tech",
    "space",
    "store",
    "website",
    "press",
    "host",
    "fun",
    "icu",
    "cyou",
    "sbs",
    "bond",
    "cfd",
    "art",
    "build",
    "ceo",
  ],
} as const;

/** 対応する全 TLD（22 種）。UI の選択肢もこの順で並べる。 */
export const SUPPORTED_TLDS: readonly string[] = [
  ...REGISTRY_TLDS.kitaqsign,
  ...REGISTRY_TLDS.kitaqnic,
];

/** TLD からレジストリを引く。未対応 TLD は null。 */
export function registryIdForTld(
  tld: string,
): Exclude<RegistryId, "mock"> | null {
  const normalized = tld.toLowerCase().replace(/^\./, "");
  if (REGISTRY_TLDS.kitaqsign.includes(normalized)) {
    return "kitaqsign";
  }
  if (REGISTRY_TLDS.kitaqnic.includes(normalized)) {
    return "kitaqnic";
  }
  return null;
}

/** 対応 TLD か判定する（ドット付き・大文字も受け付ける）。 */
export function isSupportedTld(tld: string): boolean {
  return registryIdForTld(tld) !== null;
}

/** FQDN からレジストリを引く。未対応 TLD は null。 */
export function registryIdForDomain(
  name: string,
): Exclude<RegistryId, "mock"> | null {
  return registryIdForTld(splitDomainName(name).tld);
}
