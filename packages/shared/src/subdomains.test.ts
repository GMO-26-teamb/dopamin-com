import { describe, expect, it } from "vitest";
import { DOPAMIN_NAMESERVERS } from "./constants";
import {
  buildDnsSetupInstructions,
  clampSubdomainPolicy,
  type DesiredDnsRecord,
  type DnsRecord,
  diffDnsRecords,
  dnsRecordSchema,
  dnsTargetSchema,
  githubRepoUrlSchema,
  needsNameserverSwitch,
  pickValidSubdomainItems,
  type RawSubdomainItem,
  type SubdomainItem,
  subdomainApplyState,
  subdomainHostSchema,
  subdomainItemSchema,
  subdomainItemToDnsRecord,
  subdomainPlanApplyResponseSchema,
  subdomainPlanGenerateRequestSchema,
  subdomainPlanSaveRequestSchema,
  subdomainProposalOutputSchema,
  subdomainProposalSchema,
} from "./subdomains";

const APPLIED_AT = "2026-08-26T00:00:00Z";

function item(overrides: Partial<SubdomainItem> = {}): SubdomainItem {
  return {
    host: "www",
    purpose: "ランディングページ",
    recordType: "CNAME",
    target: "cname.vercel-dns.com",
    priority: "required",
    ...overrides,
  };
}

function record(overrides: Partial<DnsRecord> = {}): DnsRecord {
  return {
    host: "www",
    recordType: "CNAME",
    target: "cname.vercel-dns.com",
    ttl: 3600,
    source: "subdomain_plan",
    appliedAt: APPLIED_AT,
    ...overrides,
  };
}

function proposalItems(): SubdomainItem[] {
  return [
    item(),
    item({ host: "api", recordType: "A", target: "203.0.113.10" }),
    item({
      host: "docs",
      target: "docs.example-app.com",
      priority: "optional",
    }),
  ];
}

describe("subdomainHostSchema", () => {
  it("1 ラベルと apex を受け付け、小文字に正規化する", () => {
    expect(subdomainHostSchema.parse("WWW")).toBe("www");
    expect(subdomainHostSchema.parse("@")).toBe("@");
    expect(subdomainHostSchema.parse("api-v2")).toBe("api-v2");
  });

  it("複数ラベル・不正文字・空文字は拒否する", () => {
    expect(subdomainHostSchema.safeParse("api.staging").success).toBe(false);
    expect(subdomainHostSchema.safeParse("-api").success).toBe(false);
    expect(subdomainHostSchema.safeParse("a_b").success).toBe(false);
    expect(subdomainHostSchema.safeParse("").success).toBe(false);
  });
});

describe("dnsTargetSchema", () => {
  it("ホスト名は小文字化し末尾ドットを落とす", () => {
    expect(dnsTargetSchema.parse("CNAME.Vercel-DNS.com.")).toBe(
      "cname.vercel-dns.com",
    );
  });

  it("IPv4 をそのまま受け付ける", () => {
    expect(dnsTargetSchema.parse("203.0.113.10")).toBe("203.0.113.10");
  });

  it("ホスト名でも IPv4 でもない値は拒否する", () => {
    expect(dnsTargetSchema.safeParse("not a host").success).toBe(false);
    expect(dnsTargetSchema.safeParse("-bad.example.com").success).toBe(false);
    expect(dnsTargetSchema.safeParse("single-label").success).toBe(false);
  });

  it("IPv4 として不正な値は A レコードの target にできない", () => {
    // `999.0.0.1` は形の上ではホスト名なので target 単体では通る（A との組合せで弾く）
    expect(dnsTargetSchema.safeParse("999.0.0.1").success).toBe(true);
    expect(
      subdomainItemSchema.safeParse(
        item({ recordType: "A", target: "999.0.0.1" }),
      ).success,
    ).toBe(false);
  });
});

describe("subdomainItemSchema", () => {
  it("A は IPv4、CNAME / ALIAS はホスト名を要求する", () => {
    expect(
      subdomainItemSchema.safeParse(
        item({ recordType: "A", target: "203.0.113.10" }),
      ).success,
    ).toBe(true);
    expect(
      subdomainItemSchema.safeParse(
        item({ recordType: "A", target: "cname.vercel-dns.com" }),
      ).success,
    ).toBe(false);
    expect(
      subdomainItemSchema.safeParse(
        item({ recordType: "CNAME", target: "203.0.113.10" }),
      ).success,
    ).toBe(false);
  });

  it("purpose は 100 文字まで", () => {
    expect(
      subdomainItemSchema.safeParse(item({ purpose: "あ".repeat(100) }))
        .success,
    ).toBe(true);
    expect(
      subdomainItemSchema.safeParse(item({ purpose: "あ".repeat(101) }))
        .success,
    ).toBe(false);
  });
});

describe("subdomainProposalSchema", () => {
  it("policy 120 字以内・items 3〜8 件・www ありなら通る", () => {
    const parsed = subdomainProposalSchema.parse({
      policy: "www と api を必須にする",
      items: proposalItems(),
    });
    expect(parsed.items).toHaveLength(3);
  });

  it("items が 3 件未満 / 8 件超は拒否する", () => {
    expect(
      subdomainProposalSchema.safeParse({
        policy: "方針",
        items: proposalItems().slice(0, 2),
      }).success,
    ).toBe(false);
    const many = Array.from({ length: 9 }, (_, i) =>
      item({ host: i === 0 ? "www" : `h${i}` }),
    );
    expect(
      subdomainProposalSchema.safeParse({ policy: "方針", items: many })
        .success,
    ).toBe(false);
  });

  it("host の重複は拒否する", () => {
    expect(
      subdomainProposalSchema.safeParse({
        policy: "方針",
        items: [...proposalItems(), item({ host: "WWW" })],
      }).success,
    ).toBe(false);
  });

  it("www を含まない提案は拒否する", () => {
    expect(
      subdomainProposalSchema.safeParse({
        policy: "方針",
        items: proposalItems().map((i) =>
          i.host === "www" ? { ...i, host: "app" } : i,
        ),
      }).success,
    ).toBe(false);
  });

  it("policy が 120 字を超えると拒否する", () => {
    expect(
      subdomainProposalSchema.safeParse({
        policy: "あ".repeat(121),
        items: proposalItems(),
      }).success,
    ).toBe(false);
  });
});

describe("subdomainProposalOutputSchema（AI の素の出力）", () => {
  it("値が妥当でなくても形が合っていれば通す（項目ごとの再検証に回す）", () => {
    const parsed = subdomainProposalOutputSchema.safeParse({
      policy: "方針",
      items: [
        // recordType と target が噛み合っていないが、ここでは弾かない
        {
          host: "www",
          purpose: "LP",
          recordType: "A",
          target: "cname.vercel-dns.com",
          priority: "required",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("形が違う（items が無い / 文字列でない）ものは拒否する", () => {
    expect(
      subdomainProposalOutputSchema.safeParse({ policy: "方針" }).success,
    ).toBe(false);
    expect(
      subdomainProposalOutputSchema.safeParse({
        policy: "方針",
        items: [{ host: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("pickValidSubdomainItems", () => {
  const raw = (
    overrides: Partial<RawSubdomainItem> = {},
  ): RawSubdomainItem => ({
    host: "www",
    purpose: "ランディングページ",
    recordType: "CNAME",
    target: "cname.vercel-dns.com",
    priority: "required",
    ...overrides,
  });

  it("不正な項目だけを落として残りを返す", () => {
    const { items, dropped } = pickValidSubdomainItems([
      raw(),
      // A なのに target がホスト名（プロンプトの例をそのまま混ぜた形）
      raw({ host: "api", recordType: "A" }),
      raw({ host: "docs", target: "dopamin.github.io", priority: "optional" }),
    ]);

    expect(items.map((i) => i.host)).toEqual(["www", "docs"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.host).toBe("api");
    expect(dropped[0]?.reason).toContain("IPv4");
  });

  it("ホスト・種別・重要度が語彙から外れた項目も落とす", () => {
    const { items, dropped } = pickValidSubdomainItems([
      raw({ host: "www.example" }),
      raw({ host: "api", recordType: "TXT" }),
      raw({ host: "docs", priority: "must" }),
    ]);

    expect(items).toHaveLength(0);
    expect(dropped.map((d) => d.host)).toEqual(["www.example", "api", "docs"]);
  });

  it("purpose の超過は落とさず切り詰める（表示上の制約なので）", () => {
    const { items, dropped } = pickValidSubdomainItems([
      raw({ purpose: "あ".repeat(200) }),
    ]);

    expect(dropped).toHaveLength(0);
    expect(items[0]?.purpose).toHaveLength(100);
  });

  it("purpose が空の項目は落とす（用途の無いホストは設計にならない）", () => {
    const { items, dropped } = pickValidSubdomainItems([raw({ purpose: " " })]);

    expect(items).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
});

describe("clampSubdomainPolicy", () => {
  it("120 字を超える方針は切り詰める", () => {
    expect(clampSubdomainPolicy(` ${"あ".repeat(200)} `)).toHaveLength(120);
    expect(clampSubdomainPolicy(" 方針 ")).toBe("方針");
  });
});

describe("githubRepoUrlSchema", () => {
  it("末尾の / と .git を落とす", () => {
    expect(githubRepoUrlSchema.parse("https://github.com/owner/repo/")).toBe(
      "https://github.com/owner/repo",
    );
    expect(githubRepoUrlSchema.parse("https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("github.com 以外・パス不足は拒否する", () => {
    expect(
      githubRepoUrlSchema.safeParse("https://gitlab.com/o/r").success,
    ).toBe(false);
    expect(
      githubRepoUrlSchema.safeParse("https://github.com/owner").success,
    ).toBe(false);
    expect(
      githubRepoUrlSchema.safeParse("http://github.com/owner/repo").success,
    ).toBe(false);
  });
});

describe("subdomainPlanGenerateRequestSchema", () => {
  it("repoUrl か description のどちらかがあれば通る", () => {
    expect(
      subdomainPlanGenerateRequestSchema.safeParse({
        repoUrl: "https://github.com/owner/repo",
      }).success,
    ).toBe(true);
    expect(
      subdomainPlanGenerateRequestSchema.safeParse({
        description: "個人開発の SaaS",
      }).success,
    ).toBe(true);
  });

  it("どちらも無ければ拒否する（AC-13-2 の代替入力）", () => {
    expect(subdomainPlanGenerateRequestSchema.safeParse({}).success).toBe(
      false,
    );
  });

  it("description は 2000 字まで", () => {
    expect(
      subdomainPlanGenerateRequestSchema.safeParse({
        description: "あ".repeat(2001),
      }).success,
    ).toBe(false);
  });
});

describe("subdomainPlanSaveRequestSchema", () => {
  it("編集後は www 無し 1 件でも保存できる", () => {
    expect(
      subdomainPlanSaveRequestSchema.safeParse({
        policy: "api だけ残す",
        items: [item({ host: "api", recordType: "A", target: "203.0.113.10" })],
      }).success,
    ).toBe(true);
  });

  it("host の重複は拒否する", () => {
    expect(
      subdomainPlanSaveRequestSchema.safeParse({
        policy: "方針",
        items: [item(), item()],
      }).success,
    ).toBe(false);
  });
});

describe("dnsRecordSchema", () => {
  it("ttl と source は既定値を補う", () => {
    const parsed = dnsRecordSchema.parse({
      host: "www",
      recordType: "CNAME",
      target: "cname.vercel-dns.com.",
      appliedAt: APPLIED_AT,
    });
    expect(parsed.ttl).toBe(3600);
    expect(parsed.source).toBe("subdomain_plan");
    expect(parsed.target).toBe("cname.vercel-dns.com");
  });
});

describe("diffDnsRecords", () => {
  it("空のゾーンでは設計がすべて added になる", () => {
    const desired = proposalItems().map((i) => subdomainItemToDnsRecord(i));
    const diff = diffDnsRecords([], desired);
    expect(diff.added).toHaveLength(3);
    expect(diff.changed).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("反映後に再計算すると差分が空になる（冪等）", () => {
    const items = proposalItems();
    const desired = items.map((i) => subdomainItemToDnsRecord(i));
    const applied: DnsRecord[] = desired.map((d) =>
      record({ host: d.host, recordType: d.recordType, target: d.target }),
    );
    const diff = diffDnsRecords(applied, desired);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged.map((d) => d.host)).toEqual(["www", "api", "docs"]);
  });

  it("target・recordType の違いは changed、設計から消えたホストは removed", () => {
    const current = [
      record({ host: "www", target: "old.vercel-dns.com" }),
      record({ host: "api", recordType: "A", target: "203.0.113.10" }),
      record({ host: "legacy", target: "legacy.example-app.com" }),
    ];
    const desired = [
      subdomainItemToDnsRecord(item()),
      subdomainItemToDnsRecord(
        item({ host: "api", target: "api.example-app.com" }),
      ),
      subdomainItemToDnsRecord(item({ host: "docs" })),
    ];
    const diff = diffDnsRecords(current, desired);
    expect(diff.added.map((d) => d.host)).toEqual(["docs"]);
    expect(diff.changed.map((c) => c.desired.host)).toEqual(["www", "api"]);
    expect(diff.changed[0]?.current.target).toBe("old.vercel-dns.com");
    expect(diff.removed.map((r) => r.host)).toEqual(["legacy"]);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("ホストの大文字小文字と target の末尾ドットは差分にしない", () => {
    const current = [record({ host: "WWW", target: "cname.vercel-dns.com." })];
    const diff = diffDnsRecords(current, [subdomainItemToDnsRecord(item())]);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });

  it("ttl の違いは changed になる", () => {
    const current = [record({ ttl: 300 })];
    const diff = diffDnsRecords(current, [subdomainItemToDnsRecord(item())]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("同じホストに複数レコードが残っていたら余りは removed になる", () => {
    const current = [
      record({ host: "www", recordType: "A", target: "203.0.113.10" }),
      record({ host: "www", recordType: "CNAME" }),
    ];
    const diff = diffDnsRecords(current, [subdomainItemToDnsRecord(item())]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]?.recordType).toBe("A");
  });

  it("apply 応答の件数（§10.1）に対応づけられる", () => {
    const diff = diffDnsRecords([record({ host: "legacy" })], [
      subdomainItemToDnsRecord(item()),
    ] satisfies DesiredDnsRecord[]);
    const response = subdomainPlanApplyResponseSchema.parse({
      added: diff.added.length,
      updated: diff.changed.length,
      removed: diff.removed.length,
      nameserversChanged: true,
    });
    expect(response).toEqual({
      added: 1,
      updated: 0,
      removed: 1,
      nameserversChanged: true,
    });
  });
});

describe("subdomainApplyState", () => {
  it("レコードが無ければ unapplied", () => {
    expect(subdomainApplyState(item(), [])).toBe("unapplied");
  });

  it("一致していれば applied", () => {
    expect(subdomainApplyState(item(), [record()])).toBe("applied");
  });

  it("設計を編集して不一致になれば changed、再反映で applied に戻る（AC-13-6）", () => {
    const edited = item({ target: "new.vercel-dns.com" });
    expect(subdomainApplyState(edited, [record()])).toBe("changed");
    const reapplied = record({ target: "new.vercel-dns.com" });
    expect(subdomainApplyState(edited, [reapplied])).toBe("applied");
  });
});

describe("needsNameserverSwitch", () => {
  it("ドパ民 DNS ならば切替不要", () => {
    expect(needsNameserverSwitch([...DOPAMIN_NAMESERVERS])).toBe(false);
    expect(
      needsNameserverSwitch([
        "NS1.dopamin.ut42tech.com.",
        "ns2.dopamin.ut42tech.com",
      ]),
    ).toBe(false);
  });

  it("他社 DNS・未設定なら切替が要る（AC-13-5）", () => {
    expect(needsNameserverSwitch(["ns1.example-dns.com"])).toBe(true);
    expect(needsNameserverSwitch([])).toBe(true);
  });
});

describe("buildDnsSetupInstructions（FR-13 手動設定）", () => {
  const items = [
    {
      host: "www",
      purpose: "ランディングページ",
      recordType: "CNAME" as const,
      target: "cname.vercel-dns.com.",
      priority: "required" as const,
    },
    {
      host: "@",
      purpose: "apex",
      recordType: "A" as const,
      target: "203.0.113.10",
      priority: "optional" as const,
    },
  ];

  it("ホストを FQDN にし、重要度を日本語で出す", () => {
    const text = buildDnsSetupInstructions("demo.com", items);
    expect(text).toContain("demo.com のサブドメイン設定手順");
    expect(text).toContain("1. www.demo.com（必須）— ランディングページ");
    // apex は FQDN としてドメイン自身になる
    expect(text).toContain("2. demo.com（任意）— apex");
  });

  it("target は末尾ドットを落として出す（保存する値と揃える）", () => {
    const text = buildDnsSetupInstructions("demo.com", items);
    expect(text).toContain("値: cname.vercel-dns.com /");
    expect(text).not.toContain("cname.vercel-dns.com.");
  });

  it("TTL は既定 3600 で、指定すればその値を出す", () => {
    expect(buildDnsSetupInstructions("demo.com", items)).toContain("TTL: 3600");
    expect(buildDnsSetupInstructions("demo.com", items, 600)).toContain(
      "TTL: 600",
    );
  });

  it("設計が空でも見出しだけは返す", () => {
    expect(buildDnsSetupInstructions("demo.com", [])).toContain(
      "demo.com のサブドメイン設定手順",
    );
  });
});
