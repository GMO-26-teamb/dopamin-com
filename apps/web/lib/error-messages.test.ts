import { API_ERROR_CODES } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import { ApiClientError, type ClientErrorCode } from "./api/errors";
import { toErrorCopy } from "./error-messages";

const ALL_CODES: readonly ClientErrorCode[] = [
  ...API_ERROR_CODES,
  "NOT_IMPLEMENTED",
  "NETWORK",
];

type ErrorInit = ConstructorParameters<typeof ApiClientError>[0];

function copyFor(
  code: ClientErrorCode,
  init: Omit<Partial<ErrorInit>, "code"> = {},
) {
  return toErrorCopy(new ApiClientError({ message: "", ...init, code }));
}

describe("toErrorCopy", () => {
  it("13 の API エラーコード + NOT_IMPLEMENTED + NETWORK すべてに文言がある", () => {
    expect(ALL_CODES).toHaveLength(15);
    for (const code of ALL_CODES) {
      const copy = copyFor(code);
      expect(copy.title, code).not.toBe("");
      expect(copy.body, code).not.toBe("");
    }
  });

  it("REGISTRY_TIMEOUT は再試行を促す", () => {
    expect(copyFor("REGISTRY_TIMEOUT").action).toBe("retry");
  });

  it("UNAUTHORIZED はログインへ誘導する", () => {
    const copy = copyFor("UNAUTHORIZED");
    expect(copy.action).toBe("login");
    expect(copy.title).toBe("セッションの有効期限が切れました");
  });

  it("NOT_FOUND / FORBIDDEN はダッシュボードへ誘導する", () => {
    expect(copyFor("NOT_FOUND").action).toBe("dashboard");
    expect(copyFor("NOT_FOUND").title).toBe("ページが見つかりません");
    expect(copyFor("FORBIDDEN").action).toBe("dashboard");
  });

  it("registry があればレジストリ名を差し込む", () => {
    expect(copyFor("REGISTRY_TIMEOUT", { registry: "kitaqsign" }).title).toBe(
      "Kitaqsign が応答しませんでした",
    );
    expect(
      copyFor("REGISTRY_UNAVAILABLE", { registry: "kitaqnic" }).title,
    ).toBe("Kitaqnic に接続できません");
  });

  it("registry が無いときは総称にフォールバックする", () => {
    expect(copyFor("REGISTRY_UNAVAILABLE").title).toBe(
      "レジストリに接続できません",
    );
  });

  it("REGISTRY_REJECTED は registryCode ごとに理由を出し分ける", () => {
    const copy = copyFor("REGISTRY_REJECTED", {
      registry: "kitaqsign",
      registryCode: "2202",
    });
    expect(copy.title).toBe("Kitaqsign が拒否しました");
    expect(copy.body).toContain("2202");
    expect(copy.body).toContain("AuthCode");
  });

  it("OPERATION_NOT_ALLOWED は details.statuses を添える", () => {
    const copy = copyFor("OPERATION_NOT_ALLOWED", {
      details: { statuses: ["clientTransferProhibited"] },
    });
    expect(copy.body).toContain("clientTransferProhibited");
    expect(copy.action).toBe("none");
  });

  it("RATE_LIMITED は details.retryAfter を秒数として使う", () => {
    const copy = copyFor("RATE_LIMITED", { details: { retryAfter: 30 } });
    expect(copy.body).toContain("30");
    expect(copy.action).toBe("retry");
  });

  it("INTERNAL は requestId を本文に含める", () => {
    const copy = copyFor("INTERNAL", { requestId: "req_01J" });
    expect(copy.title).toBe("エラーが発生しました");
    expect(copy.body).toContain("req_01J");
    expect(copy.action).toBe("retry");
  });

  it("サーバーの message があれば本文に使う", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "CONFLICT",
        message: "このドメインは取得できません。",
      }),
    );
    expect(copy.body).toBe("このドメインは取得できません。");
    expect(copy.action).toBe("none");
  });

  it("REGISTRY_TIMEOUT は message があっても FR-18 の 1 文を落とさない", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "REGISTRY_TIMEOUT",
        message: "Kitaqnic が応答しませんでした。",
        registry: "kitaqnic",
      }),
    );
    expect(copy.body).toContain("ローカルの情報は変更されていません");
    // タイトルの言い換えでしかない message は本文に複製しない
    expect(copy.body).not.toContain("応答しませんでした");
  });

  it("REGISTRY_TIMEOUT は固有の message を先頭に置いてから FR-18 の 1 文を足す", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "REGISTRY_TIMEOUT",
        message: "登録の結果を確認できませんでした。",
      }),
    );
    expect(copy.body.startsWith("登録の結果を確認できませんでした。")).toBe(
      true,
    );
    expect(copy.body).toContain("ローカルの情報は変更されていません");
  });

  it("AI_UNAVAILABLE は message があっても手入力の導線を残す", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "AI_UNAVAILABLE",
        message: "AI が利用できません。",
      }),
    );
    expect(copy.body).toContain("手入力");
  });

  it("REGISTRY_UNAVAILABLE は message があっても再試行の案内を残す", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "REGISTRY_UNAVAILABLE",
        message: "レジストリに接続できませんでした。",
        registry: "kitaqsign",
      }),
    );
    expect(copy.body).toContain("しばらく時間をおいて");
  });

  it("NOT_IMPLEMENTED は message（ルート名）と案内の両方を出す", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "NOT_IMPLEMENTED",
        message: "GET /domains はまだ実装されていません。",
      }),
    );
    expect(copy.body).toContain("GET /domains");
    expect(copy.body).toContain("NEXT_PUBLIC_API_MODE=mock");
  });

  it("union 外のコードでも落ちず INTERNAL の文言に落とす", () => {
    const copy = toErrorCopy(
      new ApiClientError({
        code: "SOMETHING_NEW" as ClientErrorCode,
        message: "未知のエラーです。",
      }),
    );
    expect(copy.title).toBe("エラーが発生しました");
    expect(copy.action).toBe("retry");
  });

  it("NOT_IMPLEMENTED / NETWORK の action", () => {
    expect(copyFor("NOT_IMPLEMENTED").action).toBe("none");
    expect(copyFor("NETWORK").action).toBe("retry");
  });
});
