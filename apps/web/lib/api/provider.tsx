"use client";

/**
 * `Services` の供給（fe-ui 設計 §4.4）。
 *
 * モード（`lib/api/mode.ts` が `NEXT_PUBLIC_API_MODE` から解決）と URL の `?mock=<scenario>` から
 * 実装を組み立てて context で配る。テストや Storybook 的な用途では `services` を直接渡せる。
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createHttpServices } from "./http/http-services";
import { createMockServices } from "./mock/mock-services";
import { type MockScenario, parseScenario } from "./mock/scenario";
import { API_MODE } from "./mode";
import type { Services } from "./services";

const ServicesContext = createContext<Services | null>(null);
const ScenarioContext = createContext<MockScenario>("default");

function readScenario(): MockScenario {
  return parseScenario(new URLSearchParams(window.location.search).get("mock"));
}

const listeners = new Set<() => void>();
let historyPatched = false;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * App Router のクライアント遷移は `history.pushState` / `replaceState` を呼ぶだけで
 * `popstate` を起こさないため、両方を包んで購読者に通知する。
 *
 * `useSearchParams()` でも同じことはできるが、使ったページが丸ごと Suspense / 動的レンダリング
 * 扱いになる（= 全ページに Suspense 境界を強いる）ので採らない。
 */
function patchHistory(): void {
  if (historyPatched) {
    return;
  }
  historyPatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      notify();
    };
  }
}

/** URL の `?mock=` を購読する。SSR / ハイドレーション時は `default`。 */
function subscribe(onChange: () => void): () => void {
  patchHistory();
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function useMockScenario(): MockScenario {
  return useContext(ScenarioContext);
}

/**
 * queryKey の先頭に付けるスコープ（`hooks.ts`）。
 *
 * 同じ key でもモード / シナリオが違えば中身は別物なので、キャッシュを混ぜない。
 * ハイドレーション直後の 1 回目は `default` で走るため、これが無いと `?mock=error` が
 * 既定シナリオの結果を掴んだままになる（`staleTime` の間ずっと）。
 */
export type QueryScope = MockScenario | "http";

export function useQueryScope(): QueryScope {
  const scenario = useMockScenario();
  return API_MODE === "http" ? "http" : scenario;
}

export function ServicesProvider(props: {
  children: ReactNode;
  services?: Services;
}) {
  const scenario = useSyncExternalStore(
    subscribe,
    readScenario,
    (): MockScenario => "default",
  );
  const services = useMemo(
    () =>
      props.services ??
      (API_MODE === "http"
        ? createHttpServices()
        : createMockServices(scenario)),
    [props.services, scenario],
  );

  return (
    <ScenarioContext.Provider value={scenario}>
      <ServicesContext.Provider value={services}>
        {props.children}
      </ServicesContext.Provider>
    </ScenarioContext.Provider>
  );
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error("useServices は AppProviders の中でだけ使えます。");
  }
  return services;
}
