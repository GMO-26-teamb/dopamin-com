import { describe, expect, it } from "vitest";
import { RegistryError } from "./errors";
import { createRegistrySet } from "./factory";
import { MockRegistryAdapter } from "./mock";
import { REGISTRY_TLDS, SUPPORTED_TLDS } from "./routing";

describe("MockRegistryAdapter: id オプション", () => {
  it("既定では mock を名乗り、全 TLD を返す（従来挙動）", async () => {
    const hello = await new MockRegistryAdapter().hello();
    expect(hello.registry).toBe("mock");
    expect(hello.tlds).toEqual([...SUPPORTED_TLDS]);
  });

  it("kitaqnic を名乗ると hello の TLD がそのレジストリの部分集合になる", async () => {
    const hello = await new MockRegistryAdapter({ id: "kitaqnic" }).hello();
    expect(hello.registry).toBe("kitaqnic");
    expect(hello.tlds).toEqual([...REGISTRY_TLDS.kitaqnic]);
  });

  it("名乗った id はエラーの registry にも載る", async () => {
    const err = await new MockRegistryAdapter({ id: "kitaqsign" })
      .info("ghost.com")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).registry).toBe("kitaqsign");
  });
});

describe("RegistrySet: 構築済みアダプタの注入（テスト用）", () => {
  it("id で登録され、mode=real の TLD ルーティングが本番同様に効く", () => {
    const kitaqsign = new MockRegistryAdapter({ id: "kitaqsign" });
    const kitaqnic = new MockRegistryAdapter({ id: "kitaqnic" });
    const set = createRegistrySet({
      mode: "real",
      adapters: [kitaqsign, kitaqnic],
    });
    expect(set.forDomain("example.com")).toBe(kitaqsign);
    expect(set.forDomain("example.xyz")).toBe(kitaqnic);
    expect(set.forTld("example")).toBeNull();
    expect(set.all()).toHaveLength(2);
  });

  it("mode=mock は従来どおり単一 mock を全 TLD に割り当てる", () => {
    const set = createRegistrySet({ mode: "mock" });
    expect(set.forDomain("example.com")?.id).toBe("mock");
    expect(set.forDomain("example.xyz")?.id).toBe("mock");
    expect(set.all()).toHaveLength(1);
  });
});
