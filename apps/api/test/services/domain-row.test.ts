import type { DomainInfo } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import {
  type DomainRecord,
  type DomainRow,
  fallbackInfo,
  toDomainRecord,
  toDomainValues,
} from "../../src/services/domain-row";

/**
 * `domains` 行 ↔ アプリ内表現の写像（docs/requirements.md §9.1）。
 * 本番の DB 経路はここを通るが、ルートの統合テストはインメモリ実装を使うため
 * この純粋関数を直接検証する。
 */

const INFO: DomainInfo = {
  name: "example.com",
  registry: "kitaqsign",
  statuses: ["ok"],
  registrant: "C-1",
  contacts: { TECH: "C-2" },
  nameservers: ["ns1.example.com", "ns2.example.com"],
  registeredAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  expiresAt: "2027-08-01T00:00:00.000Z",
  lastTransferAt: null,
  rgpStatuses: ["addPeriod"],
};

function row(overrides: Partial<DomainRow> = {}): DomainRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    name: "example.com",
    sld: "example",
    tld: "com",
    registry: "kitaqsign",
    registryRef: null,
    statuses: ["ok"],
    nameservers: ["ns1.example.com", "ns2.example.com"],
    registeredAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2027-08-01T00:00:00.000Z"),
    lastTransferAt: null,
    rgpStatus: "addPeriod",
    rgpUntil: null,
    rawInfo: INFO,
    syncedAt: new Date("2026-08-26T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    ...overrides,
  };
}

function record(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return {
    userId: "user-1",
    name: "example.com",
    registry: "kitaqsign",
    ownership: "owned",
    info: INFO,
    syncedAt: new Date("2026-08-26T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toDomainRecord", () => {
  it("raw_info が正しければそのまま DomainInfo として使う", () => {
    const result = toDomainRecord(row());
    expect(result.info).toEqual(INFO);
    expect(result).toMatchObject({
      userId: "user-1",
      name: "example.com",
      registry: "kitaqsign",
      ownership: "owned",
    });
    expect(result.syncedAt.toISOString()).toBe("2026-08-26T00:00:00.000Z");
  });

  it("registry は raw_info を優先する（列と食い違っても壊れない）", () => {
    const result = toDomainRecord(row({ registry: "kitaqnic", rawInfo: INFO }));
    expect(result.registry).toBe("kitaqsign");
  });

  it("synced_at が NULL の行は created_at を同期時刻として扱う", () => {
    const result = toDomainRecord(row({ syncedAt: null }));
    expect(result.syncedAt.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it.each([
    ["NULL", null],
    ["空オブジェクト", {}],
    ["必須フィールド欠落", { name: "example.com", registry: "kitaqsign" }],
    ["型違い", { ...INFO, statuses: "ok" }],
  ])(
    "raw_info が %s のときは型付き列から再構成する（行を落とさない）",
    (_label, rawInfo) => {
      const result = toDomainRecord(row({ rawInfo }));
      expect(result.info).toMatchObject({
        name: "example.com",
        registry: "kitaqsign",
        statuses: ["ok"],
        nameservers: ["ns1.example.com", "ns2.example.com"],
        registeredAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2027-08-01T00:00:00.000Z",
        rgpStatuses: ["addPeriod"],
      });
    },
  );
});

describe("fallbackInfo", () => {
  it("rgp_status（単一列）を rgpStatuses の配列に戻す", () => {
    expect(
      fallbackInfo(row({ rgpStatus: "redemptionPeriod" })).rgpStatuses,
    ).toEqual(["redemptionPeriod"]);
    expect(fallbackInfo(row({ rgpStatus: null })).rgpStatuses).toEqual([]);
  });

  it("registered_at が NULL なら created_at で代替する", () => {
    expect(fallbackInfo(row({ registeredAt: null })).registeredAt).toBe(
      "2026-08-01T09:00:00.000Z",
    );
  });

  it("expires_at / last_transfer_at の NULL は null のまま返す", () => {
    const info = fallbackInfo(row({ expiresAt: null, lastTransferAt: null }));
    expect(info.expiresAt).toBeNull();
    expect(info.lastTransferAt).toBeNull();
  });

  it("未知の registry 文字列は mock に丸める（例外を投げない）", () => {
    expect(fallbackInfo(row({ registry: "kitaqXXX" })).registry).toBe("mock");
  });
});

describe("toDomainValues", () => {
  it("FQDN を sld / tld 列に分割し、日付を Date に変換する", () => {
    const values = toDomainValues(record());
    expect(values).toMatchObject({
      userId: "user-1",
      name: "example.com",
      sld: "example",
      tld: "com",
      registry: "kitaqsign",
      statuses: ["ok"],
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });
    expect(values.registeredAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(values.expiresAt).toEqual(new Date("2027-08-01T00:00:00.000Z"));
    expect(values.rawInfo).toEqual(INFO);
  });

  it("expiresAt / lastTransferAt が null なら列も null にする", () => {
    const values = toDomainValues(
      record({ info: { ...INFO, expiresAt: null, lastTransferAt: null } }),
    );
    expect(values.expiresAt).toBeNull();
    expect(values.lastTransferAt).toBeNull();
  });

  it("rgp_status は redemptionPeriod を最優先で選ぶ", () => {
    const values = toDomainValues(
      record({
        info: { ...INFO, rgpStatuses: ["autoRenewPeriod", "redemptionPeriod"] },
      }),
    );
    expect(values.rgpStatus).toBe("redemptionPeriod");
  });

  it("redemptionPeriod が無ければ先頭を代表値にし、空なら null", () => {
    expect(
      toDomainValues(record({ info: { ...INFO, rgpStatuses: ["addPeriod"] } }))
        .rgpStatus,
    ).toBe("addPeriod");
    expect(
      toDomainValues(record({ info: { ...INFO, rgpStatuses: [] } })).rgpStatus,
    ).toBeNull();
  });

  it("多段ラベルでも sld 列が欠けない", () => {
    const values = toDomainValues(
      record({
        name: "api.example.com",
        info: { ...INFO, name: "api.example.com" },
      }),
    );
    expect(values.sld).toBe("api.example");
    expect(values.tld).toBe("com");
  });
});

describe("往復（record → values → row → record）", () => {
  it("書いて読み直しても DomainInfo が一致する", () => {
    const original = record();
    const values = toDomainValues(original);
    // DB が採番する列を足して行に見立てる
    const stored = row({
      ...values,
      rgpUntil: null,
      registryRef: null,
    } as Partial<DomainRow>);
    expect(toDomainRecord(stored)).toEqual(original);
  });
});
