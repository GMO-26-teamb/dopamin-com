import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DomainDetail } from "@/lib/api/types";
import { ContactCard } from "./contact-card";

/**
 * S-30 コンタクトカード（FR-07 の「登録者コンタクト（ダミー）」表示）。
 *
 * 登録者プロファイルは API の `registrantProfile` から来る。レジストリの `info` は
 * コンタクト ID しか返さないため、アプリがそのコンタクトを持っていないときは
 * 中身が分からない（`registrantProfile: null` → 空文字）。ID を氏名として出さない。
 */
function buildDomain(registrant: DomainDetail["registrant"]): DomainDetail {
  return {
    name: "takutaku.com",
    sld: "takutaku",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    displayStatus: "active",
    registeredAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2027-08-01T00:00:00.000Z",
    rgpUntil: null,
    syncedAt: "2026-08-27T00:00:00.000Z",
    stale: false,
    transfer: null,
    nameservers: [],
    registrant,
    gracePeriods: [],
    transferableFrom: null,
    subdomainPlan: null,
  };
}

describe("ContactCard（S-30）", () => {
  it("登録者の氏名とメールを出す", () => {
    render(
      <ContactCard
        domain={buildDomain({
          name: "Taro Test",
          email: "taro.test@example.com",
          migrated: true,
        })}
      />,
    );

    expect(screen.getByText("Taro Test")).toBeInTheDocument();
    expect(screen.getByText("taro.test@example.com")).toBeInTheDocument();
  });

  it("プロファイルが未取得なら空欄ではなく「未取得」を出す（#172）", () => {
    render(
      <ContactCard
        domain={buildDomain({ name: "", email: "", migrated: true })}
      />,
    );

    expect(screen.getAllByText("未取得")).toHaveLength(2);
  });
});
