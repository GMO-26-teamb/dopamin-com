import { act, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Countdown,
  formatCountdown,
  isUrgent,
  remainingMsUntil,
  useCountdown,
} from "./use-countdown";

const NOW = new Date("2026-08-26T10:00:00+09:00");

describe("formatCountdown", () => {
  it("mm:ss にゼロ埋めする", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(9_000)).toBe("00:09");
    expect(formatCountdown(65_000)).toBe("01:05");
    expect(formatCountdown(15 * 60_000)).toBe("15:00");
    expect(formatCountdown((14 * 60 + 32) * 1_000)).toBe("14:32");
  });

  it("60 分を超えても mm:ss のまま（分を繰り上げない）", () => {
    expect(formatCountdown(75 * 60_000)).toBe("75:00");
    expect(formatCountdown(3 * 60 * 60_000)).toBe("180:00");
  });

  it("秒は切り上げる（表示 00:00 の間に操作できてしまわないように）", () => {
    expect(formatCountdown(1)).toBe("00:01");
    expect(formatCountdown(1_001)).toBe("00:02");
  });

  it("負値は 00:00", () => {
    expect(formatCountdown(-1_000)).toBe("00:00");
  });
});

describe("remainingMsUntil", () => {
  it("未来の時刻までのミリ秒を返す", () => {
    expect(
      remainingMsUntil(
        "2026-08-26T01:15:00.000Z",
        Date.parse(NOW.toISOString()),
      ),
    ).toBe(15 * 60_000);
  });

  it("過去は 0、null・不正な値は null", () => {
    const now = Date.parse(NOW.toISOString());
    expect(remainingMsUntil("2026-08-26T00:00:00.000Z", now)).toBe(0);
    expect(remainingMsUntil(null, now)).toBeNull();
    expect(remainingMsUntil("not-a-date", now)).toBeNull();
  });
});

describe("isUrgent", () => {
  it("5 分以下で true、0 と null は false", () => {
    expect(isUrgent(5 * 60_000)).toBe(true);
    expect(isUrgent(5 * 60_000 + 1)).toBe(false);
    expect(isUrgent(0)).toBe(false);
    expect(isUrgent(null)).toBe(false);
  });
});

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1 秒ごとに mm:ss を更新する", () => {
    const target = new Date(NOW.getTime() + 90_000).toISOString();
    const { result } = renderHook(() => useCountdown(target));

    expect(result.current.label).toBe("01:30");
    expect(result.current.expired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.label).toBe("01:29");

    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(result.current.label).toBe("01:00");
  });

  it("0 に到達したら expired になり 00:00 で止まる", () => {
    const target = new Date(NOW.getTime() + 2_000).toISOString();
    const { result } = renderHook(() => useCountdown(target));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.label).toBe("00:00");
    expect(result.current.expired).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.label).toBe("00:00");
  });

  it("target が null のときは --:-- で expired にしない", () => {
    const { result } = renderHook(() => useCountdown(null));

    expect(result.current.label).toBe("--:--");
    expect(result.current.remainingMs).toBeNull();
    expect(result.current.expired).toBe(false);
  });

  it("target が変わったら次の tick を待たずに追従する", () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: string | null }) => useCountdown(target),
      {
        initialProps: {
          target: new Date(NOW.getTime() + 60_000).toISOString(),
        },
      },
    );
    expect(result.current.label).toBe("01:00");

    rerender({ target: new Date(NOW.getTime() + 10_000).toISOString() });
    expect(result.current.label).toBe("00:10");
  });

  it("サーバー描画では時刻を読まない（ハイドレーション不一致を避ける）", () => {
    function Probe({ target }: { target: string }): React.ReactNode {
      const countdown: Countdown = useCountdown(target);
      return <span>{countdown.label}</span>;
    }
    const html = renderToStaticMarkup(
      <Probe target={new Date(NOW.getTime() + 60_000).toISOString()} />,
    );
    expect(html).toContain("--:--");
  });
});
