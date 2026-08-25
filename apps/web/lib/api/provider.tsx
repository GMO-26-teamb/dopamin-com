"use client";

/**
 * `Services` の供給（fe-ui 設計 §4.4）。
 *
 * `NEXT_PUBLIC_API_MODE`（既定 `mock` / `http`）と URL の `?mock=<scenario>` から
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
import type { Services } from "./services";

const ServicesContext = createContext<Services | null>(null);
const ScenarioContext = createContext<MockScenario>("default");

/** `http` を明示したときだけ実 API。既定はモック。 */
function isHttpMode(): boolean {
  return process.env.NEXT_PUBLIC_API_MODE === "http";
}

function readScenario(): MockScenario {
  return parseScenario(new URLSearchParams(window.location.search).get("mock"));
}

/**
 * URL の `?mock=` を購読する。SSR / ハイドレーション時は `default`、
 * ブラウザに渡ってから実際の値になる（`popstate` でも追随する）。
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function useMockScenario(): MockScenario {
  return useContext(ScenarioContext);
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
      (isHttpMode() ? createHttpServices() : createMockServices(scenario)),
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
