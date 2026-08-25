import { createMockServices } from "@/lib/api/mock/mock-services";
import type { AuthService, Services } from "@/lib/api/services";

/**
 * 認証画面のテスト用に `Services` を組み立てる。
 * モック実装（遅延 0）をベースに、`AuthService` の一部だけ差し替える。
 */
export function servicesWithAuth(overrides: Partial<AuthService>): Services {
  const base = createMockServices("default", { delayMs: 0 });
  return { ...base, auth: { ...base.auth, ...overrides } };
}
