import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals: false なので Testing Library の自動 cleanup は効かない。明示的に呼ぶ。
afterEach(() => {
  cleanup();
});
