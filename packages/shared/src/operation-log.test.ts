import { describe, expect, it } from "vitest";
import {
  AUXILIARY_OPERATION_COMMANDS,
  isAuxiliaryOperationCommand,
  OPERATION_COMMANDS,
  OPERATION_LOG_STATUSES,
  operationCommandSchema,
  operationLogStatusFromErrorCode,
  operationLogStatusSchema,
  PRIMARY_OPERATION_COMMANDS,
} from "./operation-log";

describe("OPERATION_COMMANDS", () => {
  it("要件 §9.1 の主コマンド 15 種をこの順で持つ", () => {
    expect(PRIMARY_OPERATION_COMMANDS).toEqual([
      "check",
      "info",
      "create",
      "renew",
      "update",
      "delete",
      "restore",
      "transfer_request",
      "transfer_query",
      "transfer_approve",
      "transfer_reject",
      "transfer_cancel",
      "auth_info",
      "poll",
      "ack",
    ]);
    expect(PRIMARY_OPERATION_COMMANDS).toHaveLength(15);
  });

  it("主コマンド + 補助コマンドで構成され、重複が無い", () => {
    expect(OPERATION_COMMANDS).toEqual([
      ...PRIMARY_OPERATION_COMMANDS,
      ...AUXILIARY_OPERATION_COMMANDS,
    ]);
    expect(new Set(OPERATION_COMMANDS).size).toBe(OPERATION_COMMANDS.length);
  });

  it("すべて snake_case（コロン・ハイフンを含まない）", () => {
    for (const command of OPERATION_COMMANDS) {
      expect(command).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("registry アダプタが発行する補助コマンドを受理する", () => {
    for (const command of [
      "hello",
      "host_info",
      "host_create",
      "contact_create",
    ]) {
      expect(operationCommandSchema.parse(command)).toBe(command);
    }
  });

  it("レジストリの HTTP パス由来の表記は受理しない", () => {
    for (const command of [
      "host:info",
      "rotate-auth-info",
      "transfer:request",
    ]) {
      expect(operationCommandSchema.safeParse(command).success).toBe(false);
    }
  });

  it("isAuxiliaryOperationCommand が主 / 補助を切り分ける", () => {
    expect(isAuxiliaryOperationCommand("hello")).toBe(true);
    expect(isAuxiliaryOperationCommand("contact_create")).toBe(true);
    expect(isAuxiliaryOperationCommand("create")).toBe(false);
    expect(isAuxiliaryOperationCommand("transfer_request")).toBe(false);
  });
});

describe("operationLogStatusSchema", () => {
  it("要件 §9.1 の 4 種を受理する", () => {
    expect(OPERATION_LOG_STATUSES).toEqual([
      "success",
      "error",
      "timeout",
      "spec_mismatch",
    ]);
    for (const status of OPERATION_LOG_STATUSES) {
      expect(operationLogStatusSchema.parse(status)).toBe(status);
    }
  });

  it("それ以外は弾く", () => {
    expect(operationLogStatusSchema.safeParse("ok").success).toBe(false);
  });
});

describe("operationLogStatusFromErrorCode", () => {
  it("エラーコードが無ければ success", () => {
    expect(operationLogStatusFromErrorCode(null)).toBe("success");
    expect(operationLogStatusFromErrorCode(undefined)).toBe("success");
  });

  it("タイムアウトと仕様不一致は専用の種別にする（AC-15-1）", () => {
    expect(operationLogStatusFromErrorCode("REGISTRY_TIMEOUT")).toBe("timeout");
    expect(operationLogStatusFromErrorCode("REGISTRY_SPEC_MISMATCH")).toBe(
      "spec_mismatch",
    );
  });

  it("その他の失敗は error に寄せる", () => {
    expect(operationLogStatusFromErrorCode("REGISTRY_UNAVAILABLE")).toBe(
      "error",
    );
    expect(operationLogStatusFromErrorCode("REGISTRY_REJECTED")).toBe("error");
  });
});
