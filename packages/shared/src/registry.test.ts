import { describe, expect, it } from "vitest";
import { PRIMARY_OPERATION_COMMANDS } from "./operation-log";
import {
  POLL_MESSAGE_TYPES,
  pollMessageTypeSchema,
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
