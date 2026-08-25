import { describe, expect, it } from "vitest";
import type { SubdomainHost } from "@/lib/api/types";
import {
  appliedSummary,
  applyStatusSummary,
  countApplyStatus,
  nextHostId,
  nextHostName,
  recordText,
  zoneFileText,
} from "./apply-status";

function host(
  overrides: Partial<SubdomainHost> & { host: string },
): SubdomainHost {
  return {
    applyStatus: "pending",
    id: overrides.host,
    priority: "recommended",
    purpose: "",
    recordType: "CNAME",
    target: "cname.example-app.com",
    ...overrides,
  };
}

const HOSTS: SubdomainHost[] = [
  host({
    applyStatus: "applied",
    host: "www",
    recordType: "A",
    target: "203.0.113.10",
  }),
  host({ applyStatus: "applied", host: "api" }),
  host({ applyStatus: "changed", host: "docs" }),
  host({
    applyStatus: "pending",
    host: "status",
    recordType: "A",
    target: "203.0.113.20",
  }),
];

describe("countApplyStatus / applyStatusSummary", () => {
  it("S-43 は「反映済み 2・変更あり 1・未反映 1」", () => {
    expect(applyStatusSummary(countApplyStatus(HOSTS))).toBe(
      "反映済み 2・変更あり 1・未反映 1",
    );
  });

  it("すべて反映済みなら「反映済み 4・差分なし」（S-45）", () => {
    const applied = HOSTS.map(
      (h): SubdomainHost => ({ ...h, applyStatus: "applied" }),
    );

    expect(applyStatusSummary(countApplyStatus(applied))).toBe(
      "反映済み 4・差分なし",
    );
  });
});

describe("appliedSummary", () => {
  it("削除 0 件は出さない（S-45 のバナー本文）", () => {
    expect(appliedSummary({ added: 1, updated: 1, removed: 0 })).toBe(
      "追加 1・変更 1",
    );
  });

  it("削除があれば足す", () => {
    expect(appliedSummary({ added: 0, updated: 2, removed: 1 })).toBe(
      "追加 0・変更 2・削除 1",
    );
  });
});

describe("zoneFileText / recordText", () => {
  it("CNAME は末尾ドット、A はそのまま（手動設定用）", () => {
    expect(zoneFileText(HOSTS)).toBe(
      [
        "www 3600 IN A 203.0.113.10",
        "api 3600 IN CNAME cname.example-app.com.",
        "docs 3600 IN CNAME cname.example-app.com.",
        "status 3600 IN A 203.0.113.20",
      ].join("\n"),
    );
  });

  it("すでに末尾ドットがあれば二重にしない", () => {
    expect(
      recordText({ recordType: "CNAME", target: "cname.example.com." }),
    ).toBe("CNAME cname.example.com.");
  });
});

describe("nextHostId / nextHostName", () => {
  it("既存と衝突しない ID と名前を作る", () => {
    expect(nextHostId(HOSTS)).toBe("draft-5");
    expect(nextHostName(HOSTS)).toBe("new");
    expect(nextHostName([...HOSTS, host({ host: "new" })])).toBe("new-2");
  });
});
