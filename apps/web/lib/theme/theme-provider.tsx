"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** localStorage のキー（app/layout.tsx のインラインスクリプトと共有する） */
export const THEME_STORAGE_KEY = "dopamin-theme";

export const THEMES = ["standard", "goku"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "standard";

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" && (THEMES as readonly string[]).includes(value)
  );
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** localStorage は例外を投げうる（プライベートモード / ストレージ無効）ので必ず包む */
function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 保存できなくてもテーマ自体は効くので黙って諦める
  }
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** SSR 時の値。実際の初期テーマは layout.tsx のインラインスクリプトが決める */
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  // マウント後に localStorage の値へ揃える（SSR の HTML とズレないよう effect で行う）
  useEffect(() => {
    setThemeState(readStoredTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    // マウント直後の 1 コミット目では触らない。
    // layout.tsx のインラインスクリプトが付けた data-theme を、
    // 既定値でいったん上書きして戻す（＝ちらつく）のを避けるため。
    if (!mounted) return;
    document.documentElement.dataset.theme = theme;
  }, [mounted, theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeStoredTheme(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme は ThemeProvider の中でのみ使えます");
  }
  return value;
}
