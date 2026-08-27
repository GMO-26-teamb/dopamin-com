import { describe, expect, it } from "vitest";
import { PRIMARY_OPERATION_COMMANDS } from "./operation-log";
import {
  ALLOWED_CONTACT_ADDRESS_VALUES,
  ALLOWED_CONTACT_NAMES,
  CONTACT_ROLES,
  DEFAULT_REGISTRANT_PROFILE,
  POLL_MESSAGE_TYPES,
  pollMessageTypeSchema,
  REGISTRY_CONTACT_KEY,
  registrantProfileSchema,
  TRANSFER_STATUSES,
  transferStatusSchema,
} from "./registry";

describe("TRANSFER_STATUSES / transferStatusSchema（docs/requirements.md §11.1）", () => {
  it("移管の正規化ステータス 5 種をこの順で持つ", () => {
    expect(TRANSFER_STATUSES).toEqual([
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "none",
    ]);
    expect(TRANSFER_STATUSES).toHaveLength(5);
  });

  it.each(TRANSFER_STATUSES)("%s を受理する", (status) => {
    expect(transferStatusSchema.safeParse(status).success).toBe(true);
  });

  it("未知のステータスは拒否する", () => {
    expect(transferStatusSchema.safeParse("clientApproved").success).toBe(
      false,
    );
    expect(transferStatusSchema.safeParse("").success).toBe(false);
  });

  it("`none` を持つ（transferQuery の「移管中でない」。ADR-0002）", () => {
    // transfer query 専用エンドポイントが無く info の pendingTransfer から導出するため、
    // pending の反対側を表す値が要る。DB の transfers.status（§9.1）には保存しない。
    expect(transferStatusSchema.safeParse("none").success).toBe(true);
  });
});

describe("POLL_MESSAGE_TYPES / pollMessageTypeSchema（docs/requirements.md §11.1）", () => {
  it("Poll 通知の正規化種別 5 種をこの順で持つ", () => {
    expect(POLL_MESSAGE_TYPES).toEqual([
      "transfer_request",
      "transfer_approved",
      "transfer_rejected",
      "transfer_cancelled",
      "unknown",
    ]);
    expect(POLL_MESSAGE_TYPES).toHaveLength(5);
  });

  it.each(POLL_MESSAGE_TYPES)("%s を受理する", (type) => {
    expect(pollMessageTypeSchema.safeParse(type).success).toBe(true);
  });

  it("対応づけられない通知のための unknown を持つ（§21.2 #13）", () => {
    // レジストリの生 msgType の値域が未確定なので、落とさず unknown で持ち上げる。
    expect(pollMessageTypeSchema.safeParse("unknown").success).toBe(true);
  });

  it("operation_logs のコマンド語彙とは別物（過去形 / 現在形で区別する）", () => {
    // operation_logs は「送ったコマンド」（transfer_approve）、Poll は「起きた事実」
    // （transfer_approved）。1 文字違いで紛らわしいので取り違えを回帰で防ぐ。
    expect(POLL_MESSAGE_TYPES).not.toContain("transfer_approve");
    expect(POLL_MESSAGE_TYPES).not.toContain("transfer_reject");
    expect(POLL_MESSAGE_TYPES).not.toContain("transfer_cancel");
    expect(POLL_MESSAGE_TYPES).not.toContain("transfer_query");

    // 重なるのは transfer_request だけ（申請コマンドと、相手側に積まれる申請通知）。
    const shared = POLL_MESSAGE_TYPES.filter((type) =>
      (PRIMARY_OPERATION_COMMANDS as readonly string[]).includes(type),
    );
    expect(shared).toEqual(["transfer_request"]);
  });
});

describe("registrantProfileSchema（#72 / PII 方針）", () => {
  const VALID = {
    name: "Taro Test",
    email: "taro.test@example.com",
    street: "N/A",
    city: "N/A",
    countryCode: "JP",
  } as const;

  it("許可されたダミー値の組み合わせを受理する", () => {
    expect(registrantProfileSchema.parse(VALID)).toEqual(VALID);
    expect(registrantProfileSchema.parse(DEFAULT_REGISTRANT_PROFILE)).toEqual(
      DEFAULT_REGISTRANT_PROFILE,
    );
  });

  it("許可 8 氏名以外は弾く（実在の個人名を投入させない）", () => {
    for (const name of ALLOWED_CONTACT_NAMES) {
      expect(
        registrantProfileSchema.safeParse({ ...VALID, name }).success,
      ).toBe(true);
    }
    for (const name of [
      "山田 太郎",
      "Taro  Test",
      "Registration Private",
      "",
    ]) {
      expect(
        registrantProfileSchema.safeParse({ ...VALID, name }).success,
      ).toBe(false);
    }
  });

  it("メールは example.com / net / org のみ（配送不能な予約ドメイン）", () => {
    for (const email of [
      "a@example.com",
      "a.b+c@example.net",
      "x_1@example.org",
    ]) {
      expect(
        registrantProfileSchema.safeParse({ ...VALID, email }).success,
      ).toBe(true);
    }
    for (const email of [
      "a@gmail.com",
      "a@example.jp",
      "a@sub.example.com",
      "a@example.com.evil.jp",
      "not-an-email",
    ]) {
      expect(
        registrantProfileSchema.safeParse({ ...VALID, email }).success,
      ).toBe(false);
    }
  });

  it("住所・都市はプレースホルダのみ", () => {
    for (const value of ALLOWED_CONTACT_ADDRESS_VALUES) {
      expect(
        registrantProfileSchema.safeParse({
          ...VALID,
          street: value,
          city: value,
        }).success,
      ).toBe(true);
    }
    expect(
      registrantProfileSchema.safeParse({ ...VALID, street: "1-2-3 Chiyoda" })
        .success,
    ).toBe(false);
  });

  it("国コードは JP / US のみ", () => {
    expect(
      registrantProfileSchema.safeParse({ ...VALID, countryCode: "US" })
        .success,
    ).toBe(true);
    expect(
      registrantProfileSchema.safeParse({ ...VALID, countryCode: "FR" })
        .success,
    ).toBe(false);
  });

  it("REGISTRY_CONTACT_KEY は registrant を持たない（EPP の専用フィールドのため）", () => {
    expect(REGISTRY_CONTACT_KEY.tech).toBe("TECH");
    expect(Object.keys(REGISTRY_CONTACT_KEY)).toEqual(["tech"]);
    expect(CONTACT_ROLES).toEqual(["registrant", "tech"]);
  });
});
