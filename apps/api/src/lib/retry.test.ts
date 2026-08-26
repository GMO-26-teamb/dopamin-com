import { RegistryError, type RegistryErrorCode } from "@dopamin/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  READ_RETRY_BASE_MS,
  READ_RETRY_COUNT,
  setRetrySleepForTesting,
  withReadRetry,
} from "./retry";

/** 参照系の自動再試行（docs/requirements.md FR-18 / §11.6 (e)）。 */

/** 実時間を待たずに待機時間だけ記録する。 */
function captureSleeps(): number[] {
  const waited: number[] = [];
  setRetrySleepForTesting((ms) => {
    waited.push(ms);
    return Promise.resolve();
  });
  return waited;
}

afterEach(() => {
  setRetrySleepForTesting(null);
});

function registryError(code: RegistryErrorCode): RegistryError {
  return new RegistryError({ code, registry: "mock", message: code });
}

describe("withReadRetry", () => {
  it("成功すれば 1 回で返る（待機もしない）", async () => {
    const waited = captureSleeps();
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(withReadRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it("2 回目で成功すればその結果を返す", async () => {
    captureSleeps();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(registryError("REGISTRY_TIMEOUT"))
      .mockResolvedValue("ok");

    await expect(withReadRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("§11.6 (e): 失敗し続けても 3 回（初回 + 再試行 2 回）で止まる", async () => {
    const waited = captureSleeps();
    const error = registryError("REGISTRY_UNAVAILABLE");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withReadRetry(fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(READ_RETRY_COUNT + 1);
    // 指数バックオフ（300ms → 600ms）
    expect(waited).toEqual([READ_RETRY_BASE_MS, READ_RETRY_BASE_MS * 2]);
  });

  it("最後の失敗をそのまま投げる（コードを握り潰さない）", async () => {
    captureSleeps();
    const error = registryError("REGISTRY_TIMEOUT");
    await expect(withReadRetry(() => Promise.reject(error))).rejects.toBe(
      error,
    );
  });

  it.each<RegistryErrorCode>([
    "REGISTRY_REJECTED",
    "REGISTRY_SPEC_MISMATCH",
    "NOT_FOUND",
    "CONFLICT",
    "OPERATION_NOT_ALLOWED",
  ])(
    "%s は再試行しない（レジストリ側の事実なので答えは変わらない）",
    async (code) => {
      const waited = captureSleeps();
      const fn = vi.fn().mockRejectedValue(registryError(code));

      await expect(withReadRetry(fn)).rejects.toBeInstanceOf(RegistryError);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(waited).toEqual([]);
    },
  );

  it("RegistryError 以外は再試行しない（原因が通信とは限らない）", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withReadRetry(fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("回数と基準時間を上書きできる", async () => {
    const waited = captureSleeps();
    const fn = vi.fn().mockRejectedValue(registryError("REGISTRY_TIMEOUT"));

    await expect(
      withReadRetry(fn, { retries: 3, baseMs: 10 }),
    ).rejects.toBeInstanceOf(RegistryError);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(waited).toEqual([10, 20, 40]);
  });

  it("retries: 0 なら再試行しない", async () => {
    const fn = vi.fn().mockRejectedValue(registryError("REGISTRY_TIMEOUT"));
    await expect(withReadRetry(fn, { retries: 0 })).rejects.toBeInstanceOf(
      RegistryError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
