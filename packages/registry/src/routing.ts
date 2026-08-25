/**
 * TLD → レジストリのルーティング（docs/requirements.md §11.2）。
 *
 * 対応 TLD の定数とルーティング関数の実体は `@dopamin/shared`（`src/tlds.ts`）が持つ。
 * このパッケージはアダプタ実装（`node:crypto` 依存）を同じエントリから export していて
 * ブラウザから import できないため、UI の TLD 選択肢も shared 側を参照する。
 * ここは Bridge 層から従来どおり参照できるようにする re-export。
 */
export {
  REGISTRY_TLDS,
  registryIdForDomain,
  registryIdForTld,
  SUPPORTED_TLDS,
} from "@dopamin/shared";
