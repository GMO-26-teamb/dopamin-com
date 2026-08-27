import {
  getDefaultPreparedCorpus,
  scoreDistinctiveness,
  toDomainUniqueness,
  uniquenessPreviewResponseSchema,
} from "@dopamin/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import {
  resetRateLimitForTesting,
  UNAUTHENTICATED_RATE_LIMIT,
} from "../../src/middleware/rate-limit";

/**
 * `POST /api/v1/uniqueness/preview`（FR-05 / S-00 のお試しスコア）。
 *
 * このルートは認証もレジストリも通らないので、DB もアダプタも用意せずに検証できる。
 * origin-check（§10.2 の CSRF 対策）は全ルート共通なので、ここでも同じ扱いになることを確かめる。
 */

const ORIGIN = "http://localhost:3000";

// origin-check（§10.2）が参照する env は最初の 1 回だけ評価されるので、
// リクエストを投げる前（モジュール読み込み時）に入れておく。DB は使わないのでダミーでよい。
process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
process.env.WEBAUTHN_RP_ID = "localhost";
process.env.WEBAUTHN_ORIGIN = ORIGIN;

// スコア計算は 1 件 0.1〜0.2 秒（CI の 2 コアではその十数倍。AC-05-3 / #181）。
// 他のテストファイルと並列に走るぶんの揺らぎを吸収する。
vi.setConfig({ testTimeout: 30_000 });

// 既定コーパスの準備（9k 件弱）は初回だけ重い。ケースの中で踏むと timeout の原因になるので先に温める。
beforeAll(() => {
  getDefaultPreparedCorpus();
});

/** テストごとにレート制限のバケットを空にする（残トークンを持ち越さない）。 */
beforeEach(() => {
  resetRateLimitForTesting();
});

/** 接続元ごとに数えるので、ケースごとに別の IP を名乗る。 */
function preview(body: unknown, ip: string, init?: RequestInit) {
  return app.request("/api/v1/uniqueness/preview", {
    ...init,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...init?.headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/uniqueness/preview", () => {
  it("SLD を渡すとスコアと類似候補を返す（認証なし）", async () => {
    const res = await preview({ sld: "gogle" }, "203.0.113.1");
    expect(res.status).toBe(200);

    const body = uniquenessPreviewResponseSchema.parse(await res.json());
    expect(body.sld).toBe("gogle");
    expect(body.uniqueness.topSimilar.length).toBeGreaterThan(0);
    expect(body.uniqueness.algorithmVersion).not.toBe("");
    expect(body.uniqueness.corpusVersion).not.toBe("");
  });

  it("スコアは POST /domains/check と同じ計算結果になる", async () => {
    const res = await preview({ sld: "takutaku" }, "203.0.113.2");
    const body = uniquenessPreviewResponseSchema.parse(await res.json());

    // check.service.ts と同じ入力（既定コーパス）で計算した値
    const expected = toDomainUniqueness(
      scoreDistinctiveness("takutaku", getDefaultPreparedCorpus()),
    );
    expect(body.uniqueness).toEqual(expected);
  });

  it("FQDN で聞いても SLD だけで判定する（TLD は結果を変えない）", async () => {
    const [fromFqdn, fromSld] = await Promise.all([
      preview({ name: "Gogle.COM" }, "203.0.113.3"),
      preview({ sld: "gogle" }, "203.0.113.4"),
    ]);

    const a = uniquenessPreviewResponseSchema.parse(await fromFqdn.json());
    const b = uniquenessPreviewResponseSchema.parse(await fromSld.json());
    expect(a.sld).toBe("gogle");
    expect(a).toEqual(b);
  });

  it("形式が不正なら VALIDATION_ERROR を返す", async () => {
    for (const body of [
      { sld: "-gogle" },
      { sld: "" },
      { name: "gogle" },
      {},
    ]) {
      const res = await preview(body, "203.0.113.5");
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("同一オリジンからの呼び出しは origin-check を通る", async () => {
    const res = await preview({ sld: "gogle" }, "203.0.113.6", {
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(200);
  });

  it("別オリジンからの呼び出しは origin-check が弾く（CSRF 対策・§10.2）", async () => {
    const res = await preview({ sld: "gogle" }, "203.0.113.7", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/uniqueness/preview のレート制限", () => {
  /**
   * 回数を使うだけのリクエスト。
   * 数え上げは検証より前なので、形式エラー（400）でも 1 回ぶん減る。
   * スコア計算まで行かないぶん速いので、回数の検証にはこちらを使う。
   */
  async function burn(ip: string, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      const res = await preview({ sld: "-bad" }, ip);
      // 400 = 数えられたが通した。429 なら上限に当たっている
      expect(res.status).toBe(400);
    }
  }

  it(`同じ IP から ${UNAUTHENTICATED_RATE_LIMIT.limit} 回までは通す`, async () => {
    await burn("198.51.100.1", UNAUTHENTICATED_RATE_LIMIT.limit);
  });

  it("上限を超えたら RATE_LIMITED と再試行までの秒数を返す", async () => {
    await burn("198.51.100.2", UNAUTHENTICATED_RATE_LIMIT.limit);

    const res = await preview({ sld: "gogle" }, "198.51.100.2");
    expect(res.status).toBe(429);
    // 標準ヘッダでも同じ秒数を返す
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);

    const json = (await res.json()) as {
      error: { code: string; retryable: boolean; details: unknown };
    };
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryable).toBe(true);
    // 画面はこの秒数を「N 秒後に再試行してください」に使う（web の error-messages.ts）
    expect(json.error.details).toEqual({
      retryAfter: expect.any(Number) as number,
    });
  });

  it("接続元が違えば別に数える", async () => {
    await burn("198.51.100.3", UNAUTHENTICATED_RATE_LIMIT.limit);
    expect((await preview({ sld: "gogle" }, "198.51.100.3")).status).toBe(429);

    // 別の IP は残トークンを持ったまま
    await burn("198.51.100.4", 1);
  });

  it("スコアを返せた回も 1 回ぶんとして数える", async () => {
    expect((await preview({ sld: "gogle" }, "198.51.100.5")).status).toBe(200);
    await burn("198.51.100.5", UNAUTHENTICATED_RATE_LIMIT.limit - 1);

    expect((await preview({ sld: "gogle" }, "198.51.100.5")).status).toBe(429);
  });
});
