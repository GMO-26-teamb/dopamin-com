import { describe, expect, it } from "vitest";
import {
  nextStoredRaw,
  readStoredRaw,
  type TransferRow,
  toTransferSummary,
} from "../../src/services/transfer-row";

/** `transfers` 行 → API 要約への写像（純粋関数。§9.1 / §10.1）。 */

const CREATED_AT = new Date("2026-08-26T00:00:00.000Z");

function row(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    domainId: null,
    domainName: "move.com",
    registry: "kitaqsign",
    direction: "in",
    status: "pending",
    registryStatus: null,
    counterpartRegistrarId: null,
    registryMessageId: null,
    requestedAt: new Date("2026-08-26T00:05:00.000Z"),
    actByAt: new Date("2026-08-26T00:25:00.000Z"),
    completedAt: null,
    raw: { registry: { secret: "authInfo" } },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("toTransferSummary", () => {
  it("日時を ISO 8601 にして返す", () => {
    expect(toTransferSummary(row())).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      domainName: "move.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      registryStatus: null,
      counterpartRegistrarId: null,
      requestedAt: "2026-08-26T00:05:00.000Z",
      actByAt: "2026-08-26T00:25:00.000Z",
      completedAt: null,
      domainId: null,
    });
  });

  it("FR-18: raw と registry_message_id は載せない", () => {
    const summary = toTransferSummary(
      row({ registryMessageId: "9007199254740993" }),
    );
    expect(summary).not.toHaveProperty("raw");
    expect(summary).not.toHaveProperty("registryMessageId");
  });

  it("requested_at が無い行（Poll 由来・#58）は created_at に落とす", () => {
    expect(toTransferSummary(row({ requestedAt: null })).requestedAt).toBe(
      CREATED_AT.toISOString(),
    );
  });

  it.each([
    ["status", { status: "weird" }, { status: "pending" }],
    ["direction", { direction: "sideways" }, { direction: "in" }],
    ["registry", { registry: "unknown" }, { registry: "mock" }],
  ])(
    "%s が想定外の値でも一覧を落とさず既定値に倒す（NFR-05）",
    (_label, overrides, expected) => {
      expect(toTransferSummary(row(overrides))).toMatchObject(expected);
    },
  );
});

describe("readStoredRaw / nextStoredRaw", () => {
  it("想定外の形の raw は空として扱う", () => {
    expect(readStoredRaw("not-an-object")).toEqual({});
    expect(readStoredRaw(null)).toEqual({});
  });

  it("照合メタとレジストリ生応答を読み戻せる", () => {
    expect(
      readStoredRaw({
        registry: { code: 1000 },
        checkedAt: "2026-08-26T00:06:00.000Z",
        reconcile: "timeout_unconfirmed",
      }),
    ).toEqual({
      registry: { code: 1000 },
      checkedAt: "2026-08-26T00:06:00.000Z",
      reconcile: "timeout_unconfirmed",
    });
  });

  it("undefined を重ねたキーは JSON 化で落ちる（reconcile の印を外す用途）", () => {
    const next = nextStoredRaw(
      { reconcile: "timeout_unconfirmed", checkedAt: "2026-08-26T00:06:00Z" },
      { checkedAt: "2026-08-26T00:07:00Z", reconcile: undefined },
    );
    expect(JSON.parse(JSON.stringify(next))).toEqual({
      checkedAt: "2026-08-26T00:07:00Z",
    });
  });
});
