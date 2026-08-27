import {
  MAX_SUBDOMAIN_ITEMS,
  MAX_SUBDOMAIN_POLICY_LENGTH,
  MAX_SUBDOMAIN_PURPOSE_LENGTH,
  savedSubdomainProposalSchema,
} from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import type { SubdomainHost, SubdomainPlan } from "@/lib/api/types";
import { canAddHost, hostFieldErrors, validatePlan } from "./validate";

/**
 * 保存前の入力検証（FR-13 / AC-13-3）。
 * ここが通る設計は `PUT /domains/:name/subdomain-plan` の契約
 * （`savedSubdomainProposalSchema`）も必ず通ることを最後に突き合わせる。
 */

function host(overrides: Partial<SubdomainHost> = {}): SubdomainHost {
  return {
    id: "www",
    host: "www",
    purpose: "ランディングページ",
    recordType: "A",
    target: "203.0.113.10",
    priority: "required",
    applyStatus: "pending",
    ...overrides,
  };
}

function plan(overrides: Partial<SubdomainPlan> = {}): SubdomainPlan {
  return {
    domain: "example.com",
    repoUrl: null,
    policy: "www と api を分ける",
    hosts: [host()],
    nameserversSwitched: false,
    savedAt: null,
    appliedAt: null,
    ...overrides,
  };
}

describe("hostFieldErrors", () => {
  it("埋まっているホストはエラーなし", () => {
    expect(hostFieldErrors(host(), [host()])).toEqual({});
  });

  it("ホストを追加した直後（用途・向き先が空）を欄ごとに指摘する", () => {
    const added = host({ id: "draft-2", host: "new", purpose: "", target: "" });

    expect(hostFieldErrors(added, [added])).toEqual({
      purpose: "用途を入力してください",
      target: "向き先を入力してください",
    });
  });

  it.each([
    ["", "ホスト名を入力してください"],
    ["   ", "ホスト名を入力してください"],
    [
      "www.example",
      "ホスト名は 1 ラベル（英数字とハイフン）または apex の @ で指定してください",
    ],
    [
      "-www",
      "ホスト名は 1 ラベル（英数字とハイフン）または apex の @ で指定してください",
    ],
  ])("ホスト名 %j を弾く", (value, message) => {
    expect(hostFieldErrors(host({ host: value }), []).host).toBe(message);
  });

  it("apex の @ は正しいホスト名として通す", () => {
    expect(hostFieldErrors(host({ host: "@" }), []).host).toBeUndefined();
  });

  it("同じホスト名が 2 行あれば重複として指摘する", () => {
    const first = host({ id: "www" });
    const second = host({ id: "draft-2", host: "WWW" });

    expect(hostFieldErrors(second, [first, second]).host).toBe(
      "同じホスト名が重複しています",
    );
  });

  it("用途は上限文字数を超えたら指摘する", () => {
    const long = "あ".repeat(MAX_SUBDOMAIN_PURPOSE_LENGTH + 1);

    expect(hostFieldErrors(host({ purpose: long }), []).purpose).toBe(
      `用途は ${MAX_SUBDOMAIN_PURPOSE_LENGTH} 文字までです`,
    );
  });

  it("A レコードの向き先にホスト名を入れたら指摘する（契約と同じ規則）", () => {
    const invalid = host({ recordType: "A", target: "cname.example.com" });

    expect(hostFieldErrors(invalid, []).target).toBe(
      "A レコードの向き先は IPv4 アドレスで指定してください（例: 203.0.113.10）",
    );
  });

  it.each(["CNAME", "ALIAS"] as const)(
    "%s レコードの向き先に IPv4 を入れたら指摘する",
    (recordType) => {
      const invalid = host({ recordType, target: "203.0.113.10" });

      expect(hostFieldErrors(invalid, []).target).toBe(
        `${recordType} レコードの向き先はホスト名で指定してください（例: cname.example.com）`,
      );
    },
  );

  it("IPv4 でもホスト名でもない向き先は形式として弾く", () => {
    const invalid = host({ recordType: "CNAME", target: "!!!" });

    expect(hostFieldErrors(invalid, []).target).toBe(
      "向き先は IPv4 アドレスまたはホスト名で指定してください",
    );
  });
});

describe("validatePlan", () => {
  it("埋まっている設計は null（そのまま保存できる）", () => {
    expect(validatePlan(plan())).toBeNull();
  });

  it("ホストを全部消したら件数で止める", () => {
    expect(validatePlan(plan({ hosts: [] }))).toEqual({
      message: "ホストは 1 件以上必要です。ホストを追加してください",
      hostId: null,
    });
  });

  it("上限を超える件数で止める", () => {
    const hosts = Array.from({ length: MAX_SUBDOMAIN_ITEMS + 1 }, (_, i) =>
      host({ id: `h${i}`, host: `h${i}` }),
    );

    expect(validatePlan(plan({ hosts }))?.message).toBe(
      `ホストは ${MAX_SUBDOMAIN_ITEMS} 件までです`,
    );
  });

  it("全体方針が空なら止める", () => {
    expect(validatePlan(plan({ policy: "  " }))).toEqual({
      message: "全体方針を入力してください",
      hostId: null,
    });
  });

  it("全体方針が長すぎたら止める", () => {
    const policy = "あ".repeat(MAX_SUBDOMAIN_POLICY_LENGTH + 1);

    expect(validatePlan(plan({ policy }))?.message).toBe(
      `全体方針は ${MAX_SUBDOMAIN_POLICY_LENGTH} 文字までです`,
    );
  });

  it("欄が空のホストは、どの行かが分かる文言と hostId を返す", () => {
    const added = host({ id: "draft-2", host: "new", purpose: "", target: "" });

    expect(validatePlan(plan({ hosts: [host(), added] }))).toEqual({
      message: "new: 用途を入力してください",
      hostId: "draft-2",
    });
  });

  it("ホスト名が空の行は「（名前なし）」として指す", () => {
    const nameless = host({ id: "draft-2", host: "" });

    expect(validatePlan(plan({ hosts: [nameless] }))).toEqual({
      message: "（名前なし）: ホスト名を入力してください",
      hostId: "draft-2",
    });
  });

  it("指摘は 1 件だけ返す（先に見つかった行・欄）", () => {
    const broken = host({
      id: "draft-2",
      host: "new",
      purpose: "",
      target: "",
    });
    const alsoBroken = host({ id: "draft-3", host: "new2", purpose: "" });

    expect(validatePlan(plan({ hosts: [broken, alsoBroken] }))?.hostId).toBe(
      "draft-2",
    );
  });

  it("ここを通った設計は PUT の契約（savedSubdomainProposalSchema）も通る", () => {
    const valid = plan({
      hosts: [
        host(),
        host({
          id: "api",
          host: "api",
          purpose: "API サーバー",
          recordType: "CNAME",
          target: "api.example-app.com",
          priority: "recommended",
        }),
      ],
    });
    expect(validatePlan(valid)).toBeNull();

    const request = {
      policy: valid.policy,
      items: valid.hosts.map(
        ({ host: name, purpose, recordType, target, priority }) => ({
          host: name,
          purpose,
          recordType,
          target,
          priority,
        }),
      ),
    };
    expect(savedSubdomainProposalSchema.safeParse(request).success).toBe(true);
  });
});

describe("canAddHost", () => {
  it("上限に達するまでは追加できる", () => {
    const hosts = Array.from({ length: MAX_SUBDOMAIN_ITEMS - 1 }, (_, i) =>
      host({ id: `h${i}`, host: `h${i}` }),
    );

    expect(canAddHost(hosts)).toBe(true);
    expect(canAddHost([...hosts, host({ id: "last", host: "last" })])).toBe(
      false,
    );
  });
});
