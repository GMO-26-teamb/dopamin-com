import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { OperationLog } from "@/lib/api/types";
import { OperationLogRow } from "./operation-log-row";

/**
 * S-60 / S-61 の Log Row（Figma `77:85`）。
 * 行の折りたたみと、マスク済み request / response（AC-15-2）の表示を担保する。
 */

const REJECTED: OperationLog = {
  id: "op_004",
  at: "2026-08-26T10:31:07+09:00",
  command: "domain:transfer-request",
  registry: "kitaqsign",
  domainName: "tkt-lab.net",
  status: "error",
  errorCode: "REGISTRY_REJECTED",
  registryCode: "2202",
  latencyMs: 742,
  // レジストリに送る AuthCode は API 側で伏せ字にして返る（UI は加工しない）
  request: { name: "tkt-lab.net", authInfo: "***" },
  response: { code: 2202, msg: "Invalid authorization information" },
};

const SUCCESS: OperationLog = {
  id: "op_005",
  at: "2026-08-26T10:42:13+09:00",
  command: "domain:create",
  registry: "kitaqnic",
  domainName: "takutaku.com",
  status: "success",
  errorCode: null,
  registryCode: null,
  latencyMs: 10_000,
  request: { name: "takutaku.com", period: 1 },
  response: null,
};

function renderRow(log: OperationLog) {
  render(
    <ul>
      <OperationLogRow log={log} />
    </ul>,
  );
  return screen.getByRole("button");
}

describe("OperationLogRow", () => {
  it("日時・コマンド・レジストリ・対象・結果コード・レイテンシを 1 行に出す", () => {
    renderRow(REJECTED);

    expect(screen.getByText("08/26 10:31:07")).toBeInTheDocument();
    expect(screen.getByText("domain:transfer-request")).toBeInTheDocument();
    expect(screen.getByText("kitaqsign")).toBeInTheDocument();
    expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    expect(screen.getByText("2202 ERROR")).toBeInTheDocument();
    expect(screen.getByText("742 ms")).toBeInTheDocument();
  });

  it("レジストリコードが無い成功行は OK だけを出し、1 秒以上は秒で丸める", () => {
    renderRow(SUCCESS);

    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("10.0 s")).toBeInTheDocument();
  });

  it("既定では畳まれていて request / response を出さない", () => {
    const toggle = renderRow(REJECTED);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("request")).not.toBeInTheDocument();
    expect(screen.queryByText("response")).not.toBeInTheDocument();
  });

  it("クリックで展開し、マスク済みの値をそのまま表示する", async () => {
    const user = userEvent.setup();
    const toggle = renderRow(REJECTED);

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("request")).toBeInTheDocument();
    expect(screen.getByText("response")).toBeInTheDocument();
    // API が `***` で返した値を UI 側で伏せ字にし直したり復元したりしない
    expect(screen.getByText(/"authInfo": "\*\*\*"/)).toBeInTheDocument();
    expect(
      screen.getByText(/"msg": "Invalid authorization information"/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("エラーコード: REGISTRY_REJECTED"),
    ).toBeInTheDocument();
  });

  it("もう一度クリックすると畳む", async () => {
    const user = userEvent.setup();
    const toggle = renderRow(REJECTED);

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("request")).not.toBeInTheDocument();
  });
});
