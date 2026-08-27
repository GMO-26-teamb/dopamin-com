import { describe, expect, it } from "vitest";
import { TRANSFER_STATUSES } from "./registry";
import {
  transferDirectionSchema,
  transferIdParamSchema,
  transferRecordStatusSchema,
  transferSummarySchema,
  transfersListResponseSchema,
} from "./transfers";

/** 移管一覧・詳細の API 契約（FR-12 / §9.1 / §10.1）。 */

const SUMMARY = {
  id: "11111111-1111-4111-8111-111111111111",
  domainName: "move.example",
  registry: "kitaqsign",
  direction: "in",
  status: "pending",
  registryStatus: "pending",
  counterpartRegistrarId: "REG-OTHER",
  requestedAt: "2026-08-26T00:00:00.000Z",
  actByAt: "2026-08-26T00:20:00.000Z",
  completedAt: null,
  domainId: null,
};

describe("transferDirectionSchema", () => {
  it("in / out のみ受け付ける", () => {
    expect(transferDirectionSchema.parse("in")).toBe("in");
    expect(transferDirectionSchema.parse("out")).toBe("out");
    expect(transferDirectionSchema.safeParse("inbound").success).toBe(false);
  });
});

describe("transferRecordStatusSchema", () => {
  it("`none` を持たない（DB には移管の事実だけが残る。§9.1）", () => {
    expect(transferRecordStatusSchema.safeParse("none").success).toBe(false);
  });

  it("値域はレジストリ正規化型（TRANSFER_STATUSES）の部分集合", () => {
    for (const status of transferRecordStatusSchema.options) {
      expect(TRANSFER_STATUSES).toContain(status);
    }
  });
});

describe("transferSummarySchema", () => {
  it("§10.1 の項目を受け付ける", () => {
    expect(transferSummarySchema.parse(SUMMARY)).toMatchObject({
      domainName: "move.example",
      direction: "in",
      status: "pending",
    });
  });

  it("任意項目（registryStatus / counterpartRegistrarId）は省略できる", () => {
    const { registryStatus, counterpartRegistrarId, ...rest } = SUMMARY;
    expect(registryStatus).toBeDefined();
    expect(counterpartRegistrarId).toBeDefined();
    const parsed = transferSummarySchema.parse(rest);
    expect(parsed.registryStatus).toBeUndefined();
    expect(parsed.counterpartRegistrarId).toBeUndefined();
  });

  it("日時は null 可（レジストリが返さない場合がある）", () => {
    expect(
      transferSummarySchema.parse({
        ...SUMMARY,
        requestedAt: null,
        actByAt: null,
      }).actByAt,
    ).toBeNull();
  });

  it("FR-18: レジストリ生応答（raw）は載せない", () => {
    const parsed = transferSummarySchema.parse({
      ...SUMMARY,
      raw: { secret: "leak" },
    });
    expect(parsed).not.toHaveProperty("raw");
  });

  it("id が uuid でなければ弾く", () => {
    expect(
      transferSummarySchema.safeParse({ ...SUMMARY, id: "move.example" })
        .success,
    ).toBe(false);
  });
});

describe("transfersListResponseSchema", () => {
  it("3 区画（inbound / outbound / history）を持つ", () => {
    expect(
      transfersListResponseSchema.parse({
        inbound: [SUMMARY],
        outbound: [],
        history: [],
      }).inbound,
    ).toHaveLength(1);
  });

  it("区画が欠けていれば弾く（空配列を明示して返す契約）", () => {
    expect(
      transfersListResponseSchema.safeParse({ inbound: [], outbound: [] })
        .success,
    ).toBe(false);
  });
});

describe("transferIdParamSchema", () => {
  it("uuid のみ通す（旧パスのドメイン名は弾く）", () => {
    expect(
      transferIdParamSchema.safeParse("11111111-1111-4111-8111-111111111111")
        .success,
    ).toBe(true);
    expect(transferIdParamSchema.safeParse("move.example").success).toBe(false);
  });
});
