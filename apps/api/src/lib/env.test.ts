import { beforeEach, describe, expect, it } from "vitest";
import { getApiEnv, requireEnv, resetApiEnvCacheForTesting } from "./env";
import { ApiException } from "./errors";

// apiEnvSchema が読む変数だけをテスト間で確実にリセットする
// （シェル環境や他テストファイルの汚染を受けないようにする）
const MANAGED_KEYS = [
  "REGISTRY_MODE",
  "MOCK_REGISTRY_FAIL_MODE",
  "KITAQSIGN_BASE_URL",
  "KITAQSIGN_GATE_USER",
  "KITAQSIGN_GATE_PASSWORD",
  "KITAQSIGN_REGISTRAR_ID",
  "KITAQSIGN_API_KEY",
  "KITAQNIC_BASE_URL",
  "KITAQNIC_GATE_USER",
  "KITAQNIC_GATE_PASSWORD",
  "KITAQNIC_REGISTRAR_ID",
  "KITAQNIC_API_KEY",
  "DIRECT_DATABASE_URL",
  "MOCK_FOREIGN_REGISTRAR_ID",
  "MOCK_TRANSFER_AUTO_APPROVE_MS",
  "AI_PROVIDER",
  "AI_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_GATEWAY_API_KEY",
  "GITHUB_TOKEN",
  "DEMO_RESET_ENABLED",
  "LOG_LEVEL",
] as const;

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
  resetApiEnvCacheForTesting();
});

describe("getApiEnv: 最小構成（§17）", () => {
  it("何も設定しなくてもパースでき、既定値が入る", () => {
    const env = getApiEnv();
    expect(env.REGISTRY_MODE).toBe("mock");
    expect(env.MOCK_REGISTRY_FAIL_MODE).toBe("none");
    expect(env.AI_PROVIDER).toBe("google");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DEMO_RESET_ENABLED).toBe(false);
    expect(env.MOCK_TRANSFER_AUTO_APPROVE_MS).toBe(20 * 60 * 1000);
    // 秘密情報・未確定値は既定を持たず undefined のまま
    expect(env.AI_MODEL).toBeUndefined();
    expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AI_GATEWAY_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DIRECT_DATABASE_URL).toBeUndefined();
    expect(env.MOCK_FOREIGN_REGISTRAR_ID).toBeUndefined();
  });

  it("結果をキャッシュし、同じインスタンスを返す（NFR-05: 初回アクセス時に確定）", () => {
    expect(getApiEnv()).toBe(getApiEnv());
  });
});

describe("getApiEnv: DEMO_RESET_ENABLED（boolean coerce）", () => {
  it.each([
    ["true", true],
    ["false", false],
    ["1", false],
    ["", false],
  ] as const)("%s -> %s", (raw, expected) => {
    process.env.DEMO_RESET_ENABLED = raw;
    expect(getApiEnv().DEMO_RESET_ENABLED).toBe(expected);
  });
});

describe("getApiEnv: 空文字は未設定扱い", () => {
  it("GITHUB_TOKEN='' は undefined になる", () => {
    process.env.GITHUB_TOKEN = "";
    expect(getApiEnv().GITHUB_TOKEN).toBeUndefined();
  });
});

describe("getApiEnv: 数値の環境変数", () => {
  it("MOCK_TRANSFER_AUTO_APPROVE_MS を文字列から数値に変換する", () => {
    process.env.MOCK_TRANSFER_AUTO_APPROVE_MS = "1000";
    expect(getApiEnv().MOCK_TRANSFER_AUTO_APPROVE_MS).toBe(1000);
  });

  it("MOCK_TRANSFER_AUTO_APPROVE_MS が 0 以下だと例外", () => {
    process.env.MOCK_TRANSFER_AUTO_APPROVE_MS = "0";
    expect(() => getApiEnv()).toThrow();
  });
});

describe("getApiEnv: LOG_LEVEL", () => {
  it("info / debug 以外は例外になる", () => {
    process.env.LOG_LEVEL = "verbose";
    expect(() => getApiEnv()).toThrow();
  });

  it("debug は許可される", () => {
    process.env.LOG_LEVEL = "debug";
    expect(getApiEnv().LOG_LEVEL).toBe("debug");
  });
});

describe("getApiEnv: AI_PROVIDER", () => {
  it("google / anthropic 以外は例外になる", () => {
    process.env.AI_PROVIDER = "openai";
    expect(() => getApiEnv()).toThrow();
  });

  it("anthropic を選択できる", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(getApiEnv().AI_PROVIDER).toBe("anthropic");
  });
});

describe("requireEnv", () => {
  it("値が設定されていればそれを返す", () => {
    process.env.GITHUB_TOKEN = "ghp_xxx";
    expect(requireEnv("GITHUB_TOKEN")).toBe("ghp_xxx");
  });

  it("未設定なら 500 INTERNAL の ApiException を投げる", () => {
    expect(() => requireEnv("GITHUB_TOKEN")).toThrow(ApiException);
    try {
      requireEnv("GITHUB_TOKEN");
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      const err = e as ApiException;
      expect(err.status).toBe(500);
      expect(err.code).toBe("INTERNAL");
      expect(err.retryable).toBe(false);
    }
  });

  it("空文字も未設定として扱う", () => {
    process.env.GITHUB_TOKEN = "";
    expect(() => requireEnv("GITHUB_TOKEN")).toThrow(ApiException);
  });
});

describe("getApiEnv: AI_GATEWAY_API_KEY（#179）", () => {
  it("設定すればそのまま読める（任意。固有キーが無いときの経路で使う）", () => {
    process.env.AI_GATEWAY_API_KEY = "vck_gateway";
    expect(getApiEnv().AI_GATEWAY_API_KEY).toBe("vck_gateway");
  });

  it("空文字は未設定扱い（キーがあると誤判定して 503 を隠さない）", () => {
    process.env.AI_GATEWAY_API_KEY = "";
    expect(getApiEnv().AI_GATEWAY_API_KEY).toBeUndefined();
  });
});
