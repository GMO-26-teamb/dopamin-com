import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import type { DomainSummary, SyncFailure } from "@/lib/api/types";
import { syncNotice } from "./sync-notice";

/**
 * S-13 の Banner 文言（FR-02 / AC-18-1）。
 * 落ちた相手を名指しできるかどうかで見出しが変わる点をここで固定する。
 */

function domain(overrides: Partial<DomainSummary> = {}): DomainSummary {
  return {
    name: "example.com",
    sld: "example",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    displayStatus: "active",
    registeredAt: "2025-08-01T00:00:00.000Z",
    expiresAt: "2027-08-01T00:00:00.000Z",
    rgpUntil: null,
    syncedAt: "2026-08-26T09:18:00.000Z",
    stale: false,
    transfer: null,
    ...overrides,
  };
}

function failure(overrides: Partial<SyncFailure> = {}): SyncFailure {
  return {
    name: "ng.xyz",
    code: "REGISTRY_UNAVAILABLE",
    message: "接続できません。",
    registry: "kitaqnic",
    ...overrides,
  };
}

function notice(input: {
  error?: ApiClientError | null;
  failures?: SyncFailure[];
  domains?: DomainSummary[];
}) {
  return syncNotice({
    error: input.error ?? null,
    failures: input.failures ?? [],
    domains: input.domains ?? [domain()],
  });
}

describe("syncNotice", () => {
  it("失敗もエラーも無ければ出さない", () => {
    expect(notice({})).toBeNull();
  });

  it("片方のレジストリだけ落ちたら具体名で出し、失敗件数を添える", () => {
    const result = notice({ failures: [failure()] });

    expect(result?.title).toBe(
      "Kitaqnic が応答しません — 一覧はキャッシュを表示しています",
    );
    expect(result?.body).toBe(
      "1 件が最新化できませんでした。参照系は自動で 2 回再試行しました。しばらくして「最新化」を押してください。",
    );
  });

  it("最終同期の時刻は Banner に書かない（カードとヘッダーが持つ）", () => {
    const result = notice({
      failures: [failure({ name: "old.xyz" })],
      domains: [
        domain({ name: "fresh.com", syncedAt: "2026-08-26T09:59:30.000Z" }),
        domain({
          name: "old.xyz",
          registry: "kitaqnic",
          stale: true,
          syncedAt: "2026-08-26T08:00:00.000Z",
        }),
      ],
    });

    expect(result?.body).not.toContain("最終同期");
  });

  it("両レジストリが落ちたら総称にし、和文の前に半角スペースを入れない", () => {
    const result = notice({
      failures: [failure(), failure({ name: "a.com", registry: "kitaqsign" })],
    });

    expect(result?.title).toBe(
      "両レジストリが応答しません — 一覧はキャッシュを表示しています",
    );
    expect(result?.body).toContain("2 件が最新化できませんでした。");
  });

  it("failures が相手を名指しできないときは stale なカードから推定する", () => {
    const result = notice({
      failures: [failure({ name: "a.example", registry: null })],
      domains: [domain({ registry: "kitaqsign", stale: true })],
    });

    expect(result?.title).toBe(
      "Kitaqsign が応答しません — 一覧はキャッシュを表示しています",
    );
  });

  it("どこからも特定できなければ総称にする", () => {
    const result = notice({
      failures: [failure({ name: "a.example", registry: null })],
      domains: [domain({ stale: false })],
    });

    expect(result?.title).toBe(
      "レジストリが応答しません — 一覧はキャッシュを表示しています",
    );
  });

  it("リクエストごとのハード失敗は error.registry を使い、件数は出さない", () => {
    const result = notice({
      error: new ApiClientError({
        code: "REGISTRY_TIMEOUT",
        message: "timeout",
        registry: "kitaqsign",
      }),
    });

    expect(result?.title).toBe(
      "Kitaqsign が応答しません — 一覧はキャッシュを表示しています",
    );
    expect(result?.body).toBe(
      "参照系は自動で 2 回再試行しました。しばらくして「最新化」を押してください。",
    );
  });

  it("一覧が空でも件数だけは出す", () => {
    const result = notice({ failures: [failure()], domains: [] });

    expect(result?.body).toContain("1 件が最新化できませんでした。");
  });
});
