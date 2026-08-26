import { describe, expect, it } from "vitest";
import { domainTransferBadgeSchema } from "./api";
import { TRANSFER_STATUSES, transferStatusSchema } from "./registry";
import {
  TRANSFER_DIRECTIONS,
  TRANSFER_RECORD_STATUSES,
  transferBucket,
  transferDirectionSchema,
  transferIdParamSchema,
  transferRecordStatusSchema,
  transferSummarySchema,
  transfersListResponseSchema,
} from "./transfers";

const ID = "11111111-1111-4111-8111-111111111111";
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222";

/** `transfers` 行 1 件分の最小の有効な要約（§9.1）。 */
function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    domainName: "move.com",
    registry: "kitaqsign",
    direction: "in",
    status: "pending",
    registryStatus: null,
    counterpartRegistrarId: null,
    requestedAt: "2026-08-26T00:00:00.000Z",
    actByAt: "2026-08-26T00:20:00.000Z",
    completedAt: null,
    domainId: null,
    ...overrides,
  };
}

describe("transferRecordStatusSchema（§9.1 transfers.status）", () => {
  it("正規化ステータスから none を除いた 4 値になる", () => {
    expect(TRANSFER_RECORD_STATUSES).toEqual([
      "pending",
      "approved",
      "rejected",
      "cancelled",
    ]);
  });

  it("値域は registry.ts の TRANSFER_STATUSES から導出される（二重定義しない）", () => {
    expect([...TRANSFER_RECORD_STATUSES, "none"].sort()).toEqual(
      [...TRANSFER_STATUSES].sort(),
    );
    for (const status of TRANSFER_RECORD_STATUSES) {
      expect(transferStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("none は行のステータスとしては受理しない（行があること自体が移管の存在を意味する）", () => {
    expect(transferRecordStatusSchema.safeParse("none").success).toBe(false);
  });
});

describe("transferDirectionSchema（§9.1 transfers.direction）", () => {
  it("in / out のみを受理する", () => {
    expect(TRANSFER_DIRECTIONS).toEqual(["in", "out"]);
    expect(transferDirectionSchema.safeParse("inbound").success).toBe(false);
  });

  it("domainSummary の移管バッジ（api.ts）と同じ値域を使う", () => {
    expect(
      domainTransferBadgeSchema.safeParse({
        direction: "out",
        actByAt: "2026-08-26T00:20:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      domainTransferBadgeSchema.safeParse({
        direction: "sideways",
        actByAt: "2026-08-26T00:20:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("transferIdParamSchema（GET /transfers/:id）", () => {
  it("uuid を受理する", () => {
    expect(transferIdParamSchema.safeParse(ID).success).toBe(true);
  });

  it.each(["move.com", "-bad.com", "", "1234"])(
    "uuid でない %s は拒否する",
    (value) => {
      expect(transferIdParamSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("transferSummarySchema", () => {
  it("欠けうる値はすべて null で表せる", () => {
    expect(transferSummarySchema.safeParse(summary()).success).toBe(true);
  });

  it("値が揃っている行も受理する", () => {
    const parsed = transferSummarySchema.parse(
      summary({
        status: "approved",
        registryStatus: "clientApproved",
        counterpartRegistrarId: "MOCK-FOREIGN",
        completedAt: "2026-08-26T00:10:00.000Z",
        domainId: DOMAIN_ID,
      }),
    );
    expect(parsed.domainId).toBe(DOMAIN_ID);
  });

  it("FR-18: raw（レジストリ生応答）は載せられない", () => {
    const parsed = transferSummarySchema.parse(
      summary({ raw: { secret: "authInfo" } }),
    );
    expect(parsed).not.toHaveProperty("raw");
  });

  it("null を許さない列（id / domainName / requestedAt）は必須", () => {
    for (const key of ["id", "domainName", "requestedAt"]) {
      expect(
        transferSummarySchema.safeParse(summary({ [key]: null })).success,
      ).toBe(false);
    }
  });
});

describe("transfersListResponseSchema（GET /transfers）", () => {
  it("inbound / outbound / history の 3 キーを必須にする", () => {
    expect(
      transfersListResponseSchema.safeParse({
        inbound: [summary()],
        outbound: [],
        history: [],
      }).success,
    ).toBe(true);
    expect(
      transfersListResponseSchema.safeParse({ inbound: [], outbound: [] })
        .success,
    ).toBe(false);
  });
});

describe("transferBucket", () => {
  it("pending の IN は inbound、pending の OUT は outbound", () => {
    expect(
      transferBucket({ direction: "in", status: "pending", domainId: null }),
    ).toBe("inbound");
    expect(
      transferBucket({ direction: "out", status: "pending", domainId: null }),
    ).toBe("outbound");
  });

  it("承認済みで取り込み待ち（domainId が null）の IN は inbound に残る（§6.5 の再試行対象）", () => {
    expect(
      transferBucket({ direction: "in", status: "approved", domainId: null }),
    ).toBe("inbound");
  });

  it("取り込み済みの IN は history に移る", () => {
    expect(
      transferBucket({
        direction: "in",
        status: "approved",
        domainId: DOMAIN_ID,
      }),
    ).toBe("history");
  });

  it("完了した OUT は domainId の有無によらず history", () => {
    expect(
      transferBucket({ direction: "out", status: "approved", domainId: null }),
    ).toBe("history");
  });

  it.each(["rejected", "cancelled"] as const)("%s は history", (status) => {
    expect(transferBucket({ direction: "in", status, domainId: null })).toBe(
      "history",
    );
  });
});
