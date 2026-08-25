import { type RegistryId, splitDomainName } from "@dopamin/shared";

/**
 * TLD → レジストリのルーティング表（docs/requirements.md §11.2）。
 * `GET /sessions/hello` で確定済み（2026-08-25）。両者に重複は無い。
 * UI の TLD 選択肢もここから生成する。
 */
export const REGISTRY_TLDS: Record<
  Exclude<RegistryId, "mock">,
  readonly string[]
> = {
  kitaqsign: ["com", "net", "org", "info"],
  kitaqnic: [
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

/** 対応する全 TLD（22 種）。 */
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

/** FQDN からレジストリを引く。未対応 TLD は null。 */
export function registryIdForDomain(
  name: string,
): Exclude<RegistryId, "mock"> | null {
  return registryIdForTld(splitDomainName(name).tld);
}
