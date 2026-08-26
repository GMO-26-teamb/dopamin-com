import { describe, expect, it } from "vitest";
import {
  counterpartRegistrarId,
  isApprovedByInfo,
  toTransferSummary,
  transferDirectionOf,
} from "../../src/services/transfer.service";
import type { TransferRecord } from "../../src/services/transfer-store";

/** 移管サービスの純粋関数（FR-12 / §6.5 / §9.1 / ADR-0002）。 */

const SELF = "MOCK-REGISTRAR";
const FOREIGN = "MOCK-FOREIGN";

function record(overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
    domainId: null,
    domainName: "move.example",
    registry: "kitaqsign",
    direction: "in",
    status: "pending",
    registryStatus: "pending",
    counterpartRegistrarId: FOREIGN,
    registryMessageId: null,
    requestedAt: new Date("2026-08-26T00:00:00.000Z"),
    actByAt: new Date("2026-08-26T00:20:00.000Z"),
    completedAt: null,
    raw: { source: "test" },
    createdAt: new Date("2026-08-26T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toTransferSummary", () => {
  it("日時を ISO 8601 にし raw と registry_message_id は載せない（FR-18）", () => {
    const summary = toTransferSummary(record());
    expect(summary).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      domainName: "move.example",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      registryStatus: "pending",
      counterpartRegistrarId: FOREIGN,
      requestedAt: "2026-08-26T00:00:00.000Z",
      actByAt: "2026-08-26T00:20:00.000Z",
      completedAt: null,
      domainId: null,
    });
  });

  it("null の任意項目は省略する", () => {
    const summary = toTransferSummary(
      record({ registryStatus: null, counterpartRegistrarId: null }),
    );
    expect(summary).not.toHaveProperty("registryStatus");
    expect(summary).not.toHaveProperty("counterpartRegistrarId");
  });
});

describe("counterpartRegistrarId（ADR-0002 決定 3）", () => {
  it("自レジストラでない側を採る", () => {
    expect(
      counterpartRegistrarId(
        { requestingRegistrarId: SELF, actingRegistrarId: FOREIGN },
        SELF,
      ),
    ).toBe(FOREIGN);
    expect(
      counterpartRegistrarId(
        { requestingRegistrarId: FOREIGN, actingRegistrarId: SELF },
        SELF,
      ),
    ).toBe(FOREIGN);
  });

  it("レジストラ ID が取れなければ null（transferQuery の none など）", () => {
    expect(counterpartRegistrarId({}, SELF)).toBeNull();
  });
});

describe("transferDirectionOf", () => {
  it("申請したのが自レジストラなら in、対応するのが自レジストラなら out", () => {
    expect(
      transferDirectionOf(
        { requestingRegistrarId: SELF, actingRegistrarId: FOREIGN },
        SELF,
      ),
    ).toBe("in");
    expect(
      transferDirectionOf(
        { requestingRegistrarId: FOREIGN, actingRegistrarId: SELF },
        SELF,
      ),
    ).toBe("out");
  });

  it("どちらも自レジストラでなければ判定不能（null）", () => {
    expect(
      transferDirectionOf(
        { requestingRegistrarId: FOREIGN, actingRegistrarId: "REG-3" },
        SELF,
      ),
    ).toBeNull();
  });
});

describe("isApprovedByInfo（§6.5 の承認検知）", () => {
  // 申請 00:00、自動承認期限 00:20（+ 時計ずれ猶予 5 分 → 窓の上端は 00:25）
  const WINDOW = {
    requestedAt: new Date("2026-08-26T00:00:00.000Z"),
    actByAt: new Date("2026-08-26T00:20:00.000Z"),
  };

  it("窓の中で trDate が動いていれば承認済み", () => {
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-08-26T00:05:00.000Z" }, WINDOW),
    ).toBe(true);
  });

  it("申請より前の移管履歴では承認と見なさない", () => {
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-01-01T00:00:00.000Z" }, WINDOW),
    ).toBe(false);
  });

  it("自動承認期限を大きく過ぎた移管は自分の申請と無関係と見なす", () => {
    // 拒否・取消で pending のまま残った行が、後日の無関係な移管で承認扱いに
    // なってしまう事故を防ぐ（他人のドメイン取り込みの防止）
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-09-01T00:00:00.000Z" }, WINDOW),
    ).toBe(false);
  });

  it("時計ずれの猶予（5 分）の内側は承認と見なす", () => {
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-08-26T00:24:00.000Z" }, WINDOW),
    ).toBe(true);
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-08-26T00:26:00.000Z" }, WINDOW),
    ).toBe(false);
  });

  it("actByAt が無ければ申請 + 20 分を期限として窓を張る", () => {
    const window = { requestedAt: WINDOW.requestedAt, actByAt: null };
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-08-26T00:24:00.000Z" }, window),
    ).toBe(true);
    expect(
      isApprovedByInfo({ lastTransferAt: "2026-08-26T00:26:00.000Z" }, window),
    ).toBe(false);
  });

  it("trDate が無ければ承認と見なさない", () => {
    expect(isApprovedByInfo({ lastTransferAt: null }, WINDOW)).toBe(false);
  });

  it("日付として読めない値は承認と見なさない（NFR-05）", () => {
    expect(isApprovedByInfo({ lastTransferAt: "not-a-date" }, WINDOW)).toBe(
      false,
    );
  });

  it("申請時刻が不明なら窓を張れないので承認と見なさない（Poll に委ねる）", () => {
    expect(
      isApprovedByInfo(
        { lastTransferAt: "2026-08-26T00:05:00.000Z" },
        { requestedAt: null, actByAt: WINDOW.actByAt },
      ),
    ).toBe(false);
  });
});
