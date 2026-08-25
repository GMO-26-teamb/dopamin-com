import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "./theme-provider";

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("ThemeProvider / useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("既定は standard で、data-theme に反映する", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("standard");
    expect(document.documentElement.dataset.theme).toBe("standard");
  });

  it("setTheme('goku') で data-theme と localStorage を更新する", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("goku");
    });

    expect(result.current.theme).toBe("goku");
    expect(document.documentElement.dataset.theme).toBe("goku");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("goku");
  });

  it("setTheme('standard') で standard に戻せる", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "goku");
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("standard");
    });

    expect(document.documentElement.dataset.theme).toBe("standard");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("standard");
  });

  it("localStorage に保存済みのテーマを初回描画で復元する", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "goku");

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("goku");
    expect(document.documentElement.dataset.theme).toBe("goku");
  });

  it("保存値が不正なら standard に落とす", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "rainbow");

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("standard");
    expect(document.documentElement.dataset.theme).toBe("standard");
  });

  it("localStorage が使えなくても落ちない（プライベートモード等）", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    try {
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("standard");

      act(() => {
        result.current.setTheme("goku");
      });
      expect(result.current.theme).toBe("goku");
      expect(document.documentElement.dataset.theme).toBe("goku");
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("Provider の外で useTheme を呼ぶと投げる", () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
    } finally {
      onError.mockRestore();
    }
  });
});
