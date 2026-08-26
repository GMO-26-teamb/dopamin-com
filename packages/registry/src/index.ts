/**
 * レジストリ Bridge 層（docs/requirements.md §11）。
 * RegistryAdapter インターフェースと kitaqsign / kitaqnic / mock 実装はここに置く。
 * レジストリ固有の処理はこのパッケージの外に書かない（NFR-07）。
 */
export type { RegistryId } from "@dopamin/shared";
export type { RegistryAdapter } from "./adapter";
export type { EppEnvelope } from "./envelope";
export {
  EPP_SUCCESS_CODES,
  eppEnvelopeSchema,
  eppResultSchema,
  interpretEppResponse,
  parseResData,
} from "./envelope";
export type { RegistryErrorCode } from "./errors";
export {
  errorCodeForEppResult,
  REGISTRY_ERROR_CODES,
  RegistryError,
  userMessageForRegistryCode,
} from "./errors";
export type { RegistryMode, RegistrySetConfig } from "./factory";
export { createRegistrySet, RegistrySet } from "./factory";
export type { KitaqAdapterConfig } from "./http";
export { createKitaqAdapter } from "./kitaq";
export type { MockFailMode } from "./mock";
export { MockRegistryAdapter } from "./mock";
export type {
  MockDomainState,
  MockPollMessage,
  MockStateSnapshot,
  MockStateStore,
} from "./mock-store";
export { createInMemoryMockStore } from "./mock-store";
export type {
  ClTridFactory,
  RegistryCallObserver,
  RegistryCallRecord,
} from "./observer";
export {
  REGISTRY_TLDS,
  registryIdForDomain,
  registryIdForTld,
  SUPPORTED_TLDS,
} from "./routing";
