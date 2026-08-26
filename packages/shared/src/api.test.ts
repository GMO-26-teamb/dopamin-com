import { describe, expect, it } from "vitest";
import {
  domainAvailabilitySchema,
  domainCheckRequestSchema,
  domainCreateRequestSchema,
  domainRenewRequestSchema,
  domainUpdateRequestSchema,
  toTransferResponse,
  transferCreateRequestSchema,
  transferResponseSchema,
} from "./api";

/**
 * `api.ts` が持つ入出力スキーマ。統一エラー（§10.3）の検証は `errors.test.ts` にある
 * （#141 で `api.ts` の後方互換の別名 re-export を削除したため、ここでは扱わない）。
 */

describe("domainCheckRequestSchema（FR-03）", () => {
  it("sld + tlds を受理する（§10.4 の例に対応する入力）", () => {
    const body = { sld: "takutaku", tlds: ["com", "xyz", "net"] };
    expect(domainCheckRequestSchema.safeParse(body).success).toBe(true);
  });

  it("names[] を受理する", () => {
    const body = { names: ["takutaku.com", "takutaku.xyz"] };
    expect(domainCheckRequestSchema.safeParse(body).success).toBe(true);
  });

  // tldSchema は英字のみ許容するため、連番ではなくアルファベット2文字で生成する
  const alphaTld = (i: number) =>
    `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;

  it("tlds は 22 件まで受理する（対応 TLD 数と一致）", () => {
    const tlds = Array.from({ length: 22 }, (_, i) => alphaTld(i));
    expect(
      domainCheckRequestSchema.safeParse({ sld: "takutaku", tlds }).success,
    ).toBe(true);
  });

  it("tlds が 23 件だと拒否する", () => {
    const tlds = Array.from({ length: 23 }, (_, i) => alphaTld(i));
    expect(
      domainCheckRequestSchema.safeParse({ sld: "takutaku", tlds }).success,
    ).toBe(false);
  });

  it("tlds が空配列だと拒否する（min 1）", () => {
    expect(
      domainCheckRequestSchema.safeParse({ sld: "takutaku", tlds: [] }).success,
    ).toBe(false);
  });

  it("names は 20 件まで受理する", () => {
    const names = Array.from({ length: 20 }, (_, i) => `takutaku${i}.com`);
    expect(domainCheckRequestSchema.safeParse({ names }).success).toBe(true);
  });

  it("names が 21 件だと拒否する", () => {
    const names = Array.from({ length: 21 }, (_, i) => `takutaku${i}.com`);
    expect(domainCheckRequestSchema.safeParse({ names }).success).toBe(false);
  });

  it("names が空配列だと拒否する（min 1）", () => {
    expect(domainCheckRequestSchema.safeParse({ names: [] }).success).toBe(
      false,
    );
  });

  it("sld / names のどちらでもない入力は拒否する", () => {
    expect(domainCheckRequestSchema.safeParse({}).success).toBe(false);
  });

  it("不正な SLD（先頭ハイフン）は拒否する（AC-03-3）", () => {
    expect(
      domainCheckRequestSchema.safeParse({ sld: "-takutaku", tlds: ["com"] })
        .success,
    ).toBe(false);
  });

  it("不正な TLD（ドット付き）は拒否する", () => {
    expect(
      domainCheckRequestSchema.safeParse({
        sld: "takutaku",
        tlds: [".com"],
      }).success,
    ).toBe(false);
  });

  it("不正な FQDN（TLD なし）は拒否する", () => {
    expect(
      domainCheckRequestSchema.safeParse({ names: ["takutaku"] }).success,
    ).toBe(false);
  });
});

describe("domainAvailabilitySchema（§10.4）", () => {
  it.each(["available", "unavailable", "error"])("%s を受理する", (v) => {
    expect(domainAvailabilitySchema.safeParse(v).success).toBe(true);
  });

  it("未知の値は拒否する", () => {
    expect(domainAvailabilitySchema.safeParse("pending").success).toBe(false);
  });
});

describe("domainCreateRequestSchema（FR-06）", () => {
  it("name のみでも受理し、period は既定 1 になる", () => {
    const parsed = domainCreateRequestSchema.parse({ name: "takutaku.com" });
    expect(parsed.period).toBe(1);
    expect(parsed.nameservers).toBeUndefined();
  });

  it("period と nameservers を指定した完全な入力を受理する", () => {
    const body = {
      name: "takutaku.com",
      period: 2,
      nameservers: ["ns1.takutaku.com", "ns2.takutaku.com"],
    };
    const parsed = domainCreateRequestSchema.parse(body);
    expect(parsed).toEqual(body);
  });

  it.each([1, 10])("period 境界値 %i を受理する", (period) => {
    expect(
      domainCreateRequestSchema.safeParse({ name: "takutaku.com", period })
        .success,
    ).toBe(true);
  });

  it.each([0, 11])(
    "period 境界外の %i は拒否する（AC-08-2 の上限 10 年）",
    (period) => {
      expect(
        domainCreateRequestSchema.safeParse({ name: "takutaku.com", period })
          .success,
      ).toBe(false);
    },
  );

  it("period が整数でないと拒否する", () => {
    expect(
      domainCreateRequestSchema.safeParse({ name: "takutaku.com", period: 1.5 })
        .success,
    ).toBe(false);
  });

  it("nameservers は 13 件まで受理する", () => {
    const nameservers = Array.from(
      { length: 13 },
      (_, i) => `ns${i}.takutaku.com`,
    );
    expect(
      domainCreateRequestSchema.safeParse({ name: "takutaku.com", nameservers })
        .success,
    ).toBe(true);
  });

  it("nameservers が 14 件だと拒否する", () => {
    const nameservers = Array.from(
      { length: 14 },
      (_, i) => `ns${i}.takutaku.com`,
    );
    expect(
      domainCreateRequestSchema.safeParse({ name: "takutaku.com", nameservers })
        .success,
    ).toBe(false);
  });

  it("不正なドメイン名は拒否する", () => {
    expect(
      domainCreateRequestSchema.safeParse({ name: "not a domain" }).success,
    ).toBe(false);
  });

  it("不正なネームサーバー（単一ラベル）は拒否する", () => {
    expect(
      domainCreateRequestSchema.safeParse({
        name: "takutaku.com",
        nameservers: ["localhost"],
      }).success,
    ).toBe(false);
  });
});

describe("domainRenewRequestSchema（FR-08）", () => {
  it.each([1, 10])("period 境界値 %i を受理する", (period) => {
    expect(domainRenewRequestSchema.safeParse({ period }).success).toBe(true);
  });

  it.each([0, 11])(
    "period 境界外の %i は拒否する（AC-08-2 の上限 10 年）",
    (period) => {
      expect(domainRenewRequestSchema.safeParse({ period }).success).toBe(
        false,
      );
    },
  );

  it("period が整数でないと拒否する", () => {
    expect(domainRenewRequestSchema.safeParse({ period: 1.5 }).success).toBe(
      false,
    );
  });

  it("period が無いと拒否する（renew に既定値は無い）", () => {
    expect(domainRenewRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("domainUpdateRequestSchema（FR-09）", () => {
  it("nameservers のみの変更を受理する（2〜13 件）", () => {
    const body = { nameservers: ["ns1.takutaku.com", "ns2.takutaku.com"] };
    expect(domainUpdateRequestSchema.safeParse(body).success).toBe(true);
  });

  it("nameservers 0 件（全解除）を受理する", () => {
    expect(
      domainUpdateRequestSchema.safeParse({ nameservers: [] }).success,
    ).toBe(true);
  });

  it("nameservers 1 件は拒否する（0 件または 2〜13 件のみ）", () => {
    expect(
      domainUpdateRequestSchema.safeParse({
        nameservers: ["ns1.takutaku.com"],
      }).success,
    ).toBe(false);
  });

  it("nameservers 13 件は受理し、14 件は拒否する", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => `ns${i}.takutaku.com`);
    expect(
      domainUpdateRequestSchema.safeParse({ nameservers: make(13) }).success,
    ).toBe(true);
    expect(
      domainUpdateRequestSchema.safeParse({ nameservers: make(14) }).success,
    ).toBe(false);
  });

  it("clientStatuses の add / remove を受理する（FR-09）", () => {
    const body = {
      clientStatuses: {
        add: ["clientTransferProhibited"],
        remove: ["clientHold"],
      },
    };
    expect(domainUpdateRequestSchema.safeParse(body).success).toBe(true);
  });

  it("未知の clientStatuses 値は拒否する", () => {
    expect(
      domainUpdateRequestSchema.safeParse({
        clientStatuses: { add: ["serverHold"] },
      }).success,
    ).toBe(false);
  });

  it("変更内容が 1 つも無いと拒否する（refine: 1 つ以上指定）", () => {
    const result = domainUpdateRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "変更内容を 1 つ以上指定してください",
      );
    }
  });

  it("nameservers と clientStatuses を同時に指定できる", () => {
    const body = {
      nameservers: ["ns1.takutaku.com", "ns2.takutaku.com"],
      clientStatuses: { add: ["clientHold"] },
    };
    expect(domainUpdateRequestSchema.safeParse(body).success).toBe(true);
  });

  // §10.1 のルート一覧では `PATCH /domains/:name` の入力を
  // `{ nameservers?, contacts?, clientStatuses? }` としているが、
  // domainUpdateRequestSchema には `contacts` フィールドが無い。
  // コンタクト更新は issue #72（[api][shared] コンタクト管理）で
  // 別途スキーマ化される予定のため、ここでは実装せず TODO として残す。
  it.todo(
    "contacts（登録者・技術コンタクト更新）を受理する — §10.1 の PATCH /domains/:name 契約は" +
      " { nameservers?, contacts?, clientStatuses? } だが、domainUpdateRequestSchema に" +
      " contacts フィールドが無い（issue #72 で対応予定の既知のギャップ）",
  );
});

describe("transferCreateRequestSchema（FR-12 移管 IN）", () => {
  it("name + authCode を受理する", () => {
    const body = { name: "takutaku.com", authCode: "AbCd-1234-EfGh" };
    expect(transferCreateRequestSchema.safeParse(body).success).toBe(true);
  });

  it("authCode 64 文字は受理し、65 文字は拒否する", () => {
    expect(
      transferCreateRequestSchema.safeParse({
        name: "takutaku.com",
        authCode: "a".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      transferCreateRequestSchema.safeParse({
        name: "takutaku.com",
        authCode: "a".repeat(65),
      }).success,
    ).toBe(false);
  });

  it("authCode が空文字だと拒否する", () => {
    expect(
      transferCreateRequestSchema.safeParse({
        name: "takutaku.com",
        authCode: "",
      }).success,
    ).toBe(false);
  });

  it("authCode が無いと拒否する", () => {
    expect(
      transferCreateRequestSchema.safeParse({ name: "takutaku.com" }).success,
    ).toBe(false);
  });

  it("不正なドメイン名は拒否する", () => {
    expect(
      transferCreateRequestSchema.safeParse({
        name: "not a domain",
        authCode: "abc",
      }).success,
    ).toBe(false);
  });
});

describe("transferResponseSchema / toTransferResponse（FR-12 / ADR-0002）", () => {
  it("raw を落とし、残りのフィールドをそのまま通す", () => {
    const response = toTransferResponse({
      name: "example.com",
      status: "pending",
      registryStatus: "pending",
      requestingRegistrarId: "REG-DOPAMIN",
      actingRegistrarId: "REG-OTHER",
      requestedAt: "2026-08-26T10:00:00Z",
      actByAt: "2026-08-26T10:20:00Z",
      raw: { result: { code: 1001 }, secret: "レジストリの生応答" },
    });

    expect(response).not.toHaveProperty("raw");
    expect(JSON.stringify(response)).not.toContain("レジストリの生応答");
    expect(transferResponseSchema.parse(response)).toEqual({
      name: "example.com",
      status: "pending",
      registryStatus: "pending",
      requestingRegistrarId: "REG-DOPAMIN",
      actingRegistrarId: "REG-OTHER",
      requestedAt: "2026-08-26T10:00:00Z",
      actByAt: "2026-08-26T10:20:00Z",
    });
  });

  it("任意フィールドが無い結果は JSON 化でキーごと落ちる", () => {
    const response = toTransferResponse({
      name: "idle.com",
      status: "none",
      raw: {},
    });
    expect(JSON.parse(JSON.stringify(response))).toEqual({
      name: "idle.com",
      status: "none",
    });
  });

  it("未知の status は拒否する（レジストリの生値は registryStatus に入れる）", () => {
    expect(
      transferResponseSchema.safeParse({
        name: "example.com",
        status: "clientApproved",
      }).success,
    ).toBe(false);
  });
});
