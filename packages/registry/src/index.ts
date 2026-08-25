/**
 * レジストリ Bridge 層（docs/requirements.md §11）。
 * RegistryAdapter インターフェースと kitaqsign / kitaqnic / mock 実装はここに置く。
 * レジストリ固有の処理はこのパッケージの外に書かない（NFR-07）。
 */
export type RegistryId = "kitaqsign" | "kitaqnic" | "mock";
