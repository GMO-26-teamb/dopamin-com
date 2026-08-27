import { z } from "zod";
import {
  domainNameSchema,
  hostNameSchema,
  sldSchema,
  tldSchema,
} from "./domain-name";
import { errorCodeSchema } from "./errors";
import {
  clientStatusSchema,
  registrantProfileSchema,
  registryIdSchema,
  type TransferResult,
  transferStatusSchema,
} from "./registry";
import { pollConsumeResultSchema } from "./transfers";
import { type UniquenessResult, uniquenessLabel } from "./uniqueness";

/** `POST /domains/check` の入力（FR-03）。SLD + TLD 群、または FQDN 群のどちらか。 */
export const domainCheckRequestSchema = z.union([
  z.object({
    sld: sldSchema,
    tlds: z.array(tldSchema).min(1).max(22),
  }),
  z.object({
    names: z.array(domainNameSchema).min(1).max(20),
  }),
]);
export type DomainCheckRequest = z.infer<typeof domainCheckRequestSchema>;

export const domainAvailabilitySchema = z.enum([
  "available",
  "unavailable",
  "error",
]);
export type DomainAvailability = z.infer<typeof domainAvailabilitySchema>;

/**
 * `POST /domains/check` 応答内の独自性スコア (FR-05 / §10.4 の `uniqueness`)。
 * `similarity` は 0〜1 の文字列類似度 (§10.4 の例と同じく小数2桁へ丸める。
 * 算出方式が embedding から lexical へ変わった経緯は ADR-0003)。
 */
export const domainUniquenessSchema = z.object({
  score: z.number().int().min(0).max(100),
  label: z.enum(["high", "medium", "low"]),
  topSimilar: z
    .array(z.object({ name: z.string(), similarity: z.number().min(0).max(1) }))
    .max(3),
  /** 短名 (記号除去後3文字以下) は判定精度が構造的に低いことの明示 */
  confidence: z.enum(["normal", "low"]),
  algorithmVersion: z.string(),
  corpusVersion: z.string(),
});
export type DomainUniqueness = z.infer<typeof domainUniquenessSchema>;

/** UniquenessResult (スコア計算の生の結果) を §10.4 のワイヤ形式へ写す。 */
export function toDomainUniqueness(r: UniquenessResult): DomainUniqueness {
  return {
    score: r.score,
    label: uniquenessLabel(r.score),
    // §10.4「最も近い既存名 上位3件と類似度」。closestMatches はスコアを決めた順
    // （エントリ別スコアの昇順）で並んでいるので、表示用にここで類似度の降順へ並べ直す。
    // 類似度 0 の行は「近い既存名が無い」ことを意味するため落とす（プレフィルタで
    // 距離計算を省いた行も 0 で入ってくるので、そのまま出すと未計算値を類似度として
    // 見せてしまう）。
    topSimilar: r.closestMatches
      .filter((m) => m.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map((m) => ({
        name: m.name,
        similarity: Math.round(m.similarity * 100) / 100,
      })),
    confidence: r.confidence,
    algorithmVersion: r.algorithmVersion,
    corpusVersion: r.corpusVersion,
  };
}

/**
 * `POST /domains/check` の結果 1 件（§10.4）。
 * `uniqueness` は空きのときだけ意味を持つが、レジストリ障害で `availability: "error"` に
 * なった行でもスコアは返す（AC-05-2: スコア算出はレジストリ通信と独立している）。
 * 候補生成（FR-04）の応答も同じ形を再利用する。
 */
export const domainCheckResultSchema = z.object({
  name: domainNameSchema,
  /** 未対応 TLD で引けなかった場合は null。 */
  registry: registryIdSchema.nullable(),
  availability: domainAvailabilitySchema,
  /** レジストリが返した「空きでない理由」。 */
  reason: z.string().optional(),
  uniqueness: domainUniquenessSchema.nullable(),
  error: z.object({ code: errorCodeSchema, message: z.string() }).optional(),
});
export type DomainCheckResult = z.infer<typeof domainCheckResultSchema>;

/** `POST /domains/check` の応答（FR-03。部分失敗を許容するので行ごとに error を持つ）。 */
export const domainCheckResponseSchema = z.object({
  results: z.array(domainCheckResultSchema),
});
export type DomainCheckResponse = z.infer<typeof domainCheckResponseSchema>;

/**
 * `POST /uniqueness/preview` の入力（FR-05 / ランディング S-00 の「お試しスコア」）。
 *
 * 認証なしで叩ける口なので 1 件だけ受け取る。SLD（`takutaku`）でも
 * FQDN（`takutaku.com`）でもよい。どちらもスコアは SLD 部分だけで決まる
 * （`POST /domains/check` の `uniqueness` と同じ計算）。
 */
export const uniquenessPreviewRequestSchema = z.union([
  z.object({ sld: sldSchema }),
  z.object({ name: domainNameSchema }),
]);
export type UniquenessPreviewRequest = z.infer<
  typeof uniquenessPreviewRequestSchema
>;

/**
 * `POST /uniqueness/preview` の応答。
 * 空き確認（FR-03）はしないので、スコアだけを `POST /domains/check` と同じ形で返す。
 */
export const uniquenessPreviewResponseSchema = z.object({
  /** スコアの対象になった SLD（FQDN で聞いても TLD は判定に使わない）。 */
  sld: z.string(),
  uniqueness: domainUniquenessSchema,
});
export type UniquenessPreviewResponse = z.infer<
  typeof uniquenessPreviewResponseSchema
>;

/** `POST /domains` の入力（FR-06）。 */
export const domainCreateRequestSchema = z.object({
  name: domainNameSchema,
  /** 登録期間（年）。既定 1 年。 */
  period: z.number().int().min(1).max(10).default(1),
  nameservers: z.array(hostNameSchema).max(13).optional(),
  /**
   * 登録者コンタクト（FR-06）。省略すると `DEFAULT_REGISTRANT_PROFILE`
   * （既定のダミー登録者）で登録する（従来どおり）。
   *
   * `PATCH /domains/:name` と同じく **プロファイルそのもの**を受け取り、
   * ID の用意（作成 or 更新）は API 側で行う（`contact.service.ts`。
   * ユーザー × レジストリ × ロールで 1 件を使い回す）。
   * Admin / Billing は扱わない（ICANN Registration Data Policy）。
   */
  contacts: z.object({ registrant: registrantProfileSchema }).optional(),
});
export type DomainCreateRequest = z.infer<typeof domainCreateRequestSchema>;

/** `POST /domains/:name/renew` の入力（FR-08）。 */
export const domainRenewRequestSchema = z.object({
  period: z.number().int().min(1).max(10),
});
export type DomainRenewRequest = z.infer<typeof domainRenewRequestSchema>;

/** `PATCH /domains/:name` の入力（FR-09）。nameservers は「変更後の全量」を渡す。 */
export const domainUpdateRequestSchema = z
  .object({
    nameservers: z
      .array(hostNameSchema)
      .max(13)
      .refine((v) => v.length === 0 || v.length >= 2, {
        message:
          "ネームサーバは 0 件（全解除）または 2〜13 件で指定してください",
      })
      .optional(),
    clientStatuses: z
      .object({
        add: z.array(clientStatusSchema).optional(),
        remove: z.array(clientStatusSchema).optional(),
      })
      .optional(),
    /**
     * コンタクトの変更（FR-09）。値はレジストリのコンタクト ID ではなく
     * **プロファイルそのもの**を受け取り、ID の用意（作成 or 更新）は API 側で行う
     * （`contact.service.ts`。ユーザー × レジストリで 1 件を使い回す）。
     * Admin / Billing は扱わない（ICANN Registration Data Policy）。
     */
    contacts: z
      .object({
        registrant: registrantProfileSchema.optional(),
        tech: registrantProfileSchema.optional(),
      })
      .refine((v) => v.registrant !== undefined || v.tech !== undefined, {
        message: "変更するコンタクトを 1 つ以上指定してください",
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.nameservers !== undefined ||
      v.clientStatuses !== undefined ||
      v.contacts !== undefined,
    {
      message: "変更内容を 1 つ以上指定してください",
    },
  );
export type DomainUpdateRequest = z.infer<typeof domainUpdateRequestSchema>;

/** `POST /transfers` の入力（FR-12 移管 IN）。 */
export const transferCreateRequestSchema = z.object({
  name: domainNameSchema,
  authCode: z.string().min(1).max(64),
});
export type TransferCreateRequest = z.infer<typeof transferCreateRequestSchema>;

/**
 * `POST /transfers` / `GET /transfers/:name` が返す移管情報（FR-12）。
 *
 * 正規化型 {@link TransferResult} から `raw`（レジストリの生応答）を除いたもの。
 * レジストリの生の出力は画面に流さない方針（FR-18 / NFR-03）に合わせ、API 境界で剥がす
 * （ADR-0002）。web もこのスキーマで応答を検証する（形の二重定義を作らない）。
 */
export const transferResponseSchema = z.object({
  name: z.string(),
  status: transferStatusSchema,
  registryStatus: z.string().optional(),
  requestingRegistrarId: z.string().optional(),
  actingRegistrarId: z.string().optional(),
  requestedAt: z.string().optional(),
  actByAt: z.string().optional(),
  newExpiresAt: z.string().optional(),
});
export type TransferResponse = z.infer<typeof transferResponseSchema>;

/** 正規化結果 → API 応答。`raw` を落とすだけの純関数（分割代入せず明示的に組み立てる）。 */
export function toTransferResponse(result: TransferResult): TransferResponse {
  return {
    name: result.name,
    status: result.status,
    registryStatus: result.registryStatus,
    requestingRegistrarId: result.requestingRegistrarId,
    actingRegistrarId: result.actingRegistrarId,
    requestedAt: result.requestedAt,
    actByAt: result.actByAt,
    newExpiresAt: result.newExpiresAt,
  };
}

/**
 * §9.1 の所有権。`transferred_out`（移管 OUT 完了）は表示のみで全操作不可（AC-12-5）。
 */
export const ownershipSchema = z.enum(["owned", "transferred_out"]);
export type Ownership = z.infer<typeof ownershipSchema>;

/** 進行中の移管（FR-12）。`actByAt` はサーバ自動承認の期限（申請 + 20 分）。 */
export const domainTransferBadgeSchema = z.object({
  direction: z.enum(["in", "out"]),
  actByAt: z.string(),
});

/**
 * 保有ドメイン 1 件の要約（`GET /domains` / `POST /domains/sync`。FR-02）。
 *
 * 表示ステータスは含めない。EPP ステータスの解釈は `deriveDisplayStatus` が SSOT で、
 * API・Web の双方がこの要約を入力にして同じ結果を導出する（web 側の ViewModel は
 * これに `displayStatus` を足したもの）。
 */
export const domainSummarySchema = z.object({
  name: z.string(),
  sld: z.string(),
  tld: z.string(),
  registry: registryIdSchema,
  statuses: z.array(z.string()),
  rgpStatuses: z.array(z.string()),
  ownership: ownershipSchema,
  registeredAt: z.string(),
  expiresAt: z.string().nullable(),
  rgpUntil: z.string().nullable(),
  /** 最後にレジストリと同期できた時刻（ISO 8601）。 */
  syncedAt: z.string(),
  /** true = 直近の同期に失敗し DB キャッシュを表示している（AC-07-2）。 */
  stale: z.boolean(),
  /** 移管一覧（FR-12）を実装するまでは常に null。 */
  transfer: domainTransferBadgeSchema.nullable(),
});
export type DomainSummary = z.infer<typeof domainSummarySchema>;

/** `GET /domains` のレスポンス（FR-02）。 */
export const domainListResponseSchema = z.object({
  domains: z.array(domainSummarySchema),
});
export type DomainListResponse = z.infer<typeof domainListResponseSchema>;

/** `POST /domains/sync` で同期できなかったドメイン（部分失敗を許容する）。 */
export const domainSyncFailureSchema = z.object({
  name: z.string(),
  code: errorCodeSchema,
  message: z.string(),
});

/** `POST /domains/sync` のレスポンス（FR-02）。失敗した行は stale: true で返る。 */
export const domainSyncResponseSchema = z.object({
  domains: z.array(domainSummarySchema),
  failures: z.array(domainSyncFailureSchema),
});
export type DomainSyncResponse = z.infer<typeof domainSyncResponseSchema>;

/**
 * `POST /domains/sync` の実レスポンス（FR-02 / FR-12。§10.1）。
 * 同期に加えて Poll も消化する（AC-02-4）ので、その内訳を足して返す。
 * 既存の利用側が `domains` / `failures` だけを読めるよう、拡張として重ねている。
 */
export const domainSyncWithPollResponseSchema = domainSyncResponseSchema.extend(
  { pollProcessed: pollConsumeResultSchema },
);
export type DomainSyncWithPollResponse = z.infer<
  typeof domainSyncWithPollResponseSchema
>;
