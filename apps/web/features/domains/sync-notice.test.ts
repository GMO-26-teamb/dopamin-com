import { userMessageForRegistryCode } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import type { DomainSummary, SyncFailure } from "@/lib/api/types";
import { syncNotice } from "./sync-notice";

/**
 * S-13 の Banner 文言（FR-02 / AC-18-1）。
 * 落ちた相手を名指しできるかどうかで見出しが変わる点と、
 * 失敗コードごとに見出し・案内が変わる点（#184）をここで固定する。
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
      "1 件が最新化できませんでした。自動で 2 回試し直しました。しばらくして「最新化」を押してください。",
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
      "自動で 2 回試し直しました。しばらくして「最新化」を押してください。",
    );
  });

  it("一覧が空でも件数だけは出す", () => {
    const result = notice({ failures: [failure()], domains: [] });

    expect(result?.body).toContain("1 件が最新化できませんでした。");
  });

  // ---- 失敗コード別の出し分け（#184） ----

  it("NOT_FOUND だけなら「応答しません」と言わない（レジストリ障害に見せない）", () => {
    const result = notice({
      failures: [
        failure({
          name: "gone.com",
          code: "NOT_FOUND",
          message: "対象のドメインが見つかりません。",
          registry: "kitaqsign",
        }),
      ],
    });

    expect(result?.title).toBe(
      "Kitaqsign に登録が見つかりません — 一覧はキャッシュを表示しています",
    );
    expect(result?.title).not.toContain("応答しません");
  });

  it("NOT_FOUND は再試行の対象外なので「2 回試し直しました」を出さない", () => {
    const result = notice({
      failures: [
        failure({
          name: "gone.com",
          code: "NOT_FOUND",
          message: "対象のドメインが見つかりません。",
          registry: "kitaqsign",
        }),
      ],
    });

    expect(result?.body).toBe(
      "1 件が最新化できませんでした。レジストリ側に登録がありません。操作ログで詳細を確認してください。",
    );
    expect(result?.body).not.toContain("試し直し");
  });

  it("REGISTRY_REJECTED は registryCode 由来の理由を本文に出す", () => {
    // API は `registryErrorMessage` が `userMessageForRegistryCode` の理由を message に載せる
    const reason = userMessageForRegistryCode("2304", "info");

    const result = notice({
      failures: [
        failure({
          name: "locked.com",
          code: "REGISTRY_REJECTED",
          message: reason ?? "",
          registry: "kitaqsign",
        }),
      ],
    });

    expect(result?.title).toBe(
      "Kitaqsign が最新化を拒否しました — 一覧はキャッシュを表示しています",
    );
    expect(result?.body).toBe(
      "1 件が最新化できませんでした。現在のステータスではこの操作を実行できません。",
    );
  });

  it("REGISTRY_REJECTED の理由が 1 つに定まらなければ操作ログへ誘導する", () => {
    const result = notice({
      failures: [
        failure({
          name: "a.com",
          code: "REGISTRY_REJECTED",
          message: "認証情報が正しくありません。",
          registry: "kitaqsign",
        }),
        failure({
          name: "b.com",
          code: "REGISTRY_REJECTED",
          message: "現在のステータスではこの操作を実行できません。",
          registry: "kitaqsign",
        }),
      ],
    });

    expect(result?.body).toBe(
      "2 件が最新化できませんでした。操作ログで理由を確認してください。",
    );
  });

  it("REGISTRY_SPEC_MISMATCH は見出しを事実だけにし、仕様変更の可能性は本文に出す", () => {
    const result = notice({
      failures: [
        failure({
          name: "odd.com",
          code: "REGISTRY_SPEC_MISMATCH",
          message: "Kitaqsign の応答が想定と異なります。",
          registry: "kitaqsign",
        }),
      ],
    });

    expect(result?.title).toBe("Kitaqsign の応答が想定と異なります");
    expect(result?.body).toBe(
      "1 件が最新化できませんでした。レジストリの仕様が変わった可能性があります。操作ログを確認してください。",
    );
  });

  it("レジストリ由来でないコードはレジストリ障害と言わず、理由をそのまま出す", () => {
    const result = notice({
      failures: [
        failure({
          name: "a.example",
          code: "VALIDATION_ERROR",
          message: "未対応の TLD です。",
          registry: null,
        }),
      ],
    });

    expect(result?.title).toBe(
      "一覧を最新化できませんでした — キャッシュを表示しています",
    );
    expect(result?.body).toBe(
      "1 件が最新化できませんでした。未対応の TLD です。",
    );
  });

  it("リクエストごとのハード失敗もコードで出し分ける（INTERNAL を障害と言わない）", () => {
    const result = notice({
      error: new ApiClientError({
        code: "INTERNAL",
        message: "サーバーエラー",
      }),
      domains: [domain({ stale: true })],
    });

    expect(result?.title).toBe(
      "一覧を最新化できませんでした — キャッシュを表示しています",
    );
    expect(result?.body).toBe("時間をおいて「最新化」を押してください。");
  });

  it("コードが混ざるときは最も重いコードの見出しにし、内訳を本文に出す", () => {
    const result = notice({
      failures: [
        failure({
          name: "gone1.com",
          code: "NOT_FOUND",
          message: "対象のドメインが見つかりません。",
          registry: "kitaqsign",
        }),
        failure({
          name: "gone2.com",
          code: "NOT_FOUND",
          message: "対象のドメインが見つかりません。",
          registry: "kitaqsign",
        }),
        failure({ name: "ng.xyz" }),
      ],
    });

    // 疎通障害が 1 件でも混ざっていれば「待って再試行」が最も行動につながる。
    // 見出しの主語も落ちている Kitaqnic だけにし、「両レジストリ」に薄めない
    expect(result?.title).toBe(
      "Kitaqnic が応答しません — 一覧はキャッシュを表示しています",
    );
    expect(result?.body).toBe(
      "3 件が最新化できませんでした（応答なし 1 件・レジストリに未登録 2 件）。自動で 2 回試し直しました。しばらくして「最新化」を押してください。",
    );
  });
});
