import { describe, expect, it } from "vitest";
import {
  connectTestRequested,
  kitaqConfigFromEnv,
  loadEnvLocal,
} from "./helpers/connect";
import { registryLifecycleSuite } from "./helpers/registry-lifecycle";

// 実行ガードは .env.local 読込より先に評価する（.env.local に REGISTRY_CONNECT_TEST を
// 書いても通常の pnpm test が実レジストリテストに化けないように、シェル環境変数のみを見る）
const requested = connectTestRequested();
loadEnvLocal();
const config = kitaqConfigFromEnv("kitaqsign");

/**
 * kitaqsign（.com .net。8/27 に .org / .info は kitaqnic へ移管）への疎通テスト。
 * REGISTRY_CONNECT_TEST=1 のときだけ実行される（実データに反映されるため）。
 * 実行方法: docs/testing.md
 */
describe.skipIf(!requested)(
  "kitaqsign 疎通（実レジストリ・副作用あり）",
  () => {
    if (!config) {
      it("KITAQSIGN_* の認証情報が設定されていること", () => {
        expect.fail(
          "KITAQSIGN_* の認証情報が見つかりません。apps/api/.env.local を設定してください。",
        );
      });
      return;
    }
    registryLifecycleSuite(config, "com");
  },
);
