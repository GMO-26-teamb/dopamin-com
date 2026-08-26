import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { ApiException } from "./errors";

/** zod の issue のうち §10.3 の `details` に写す部分だけ（classic / core の型差を吸収する）。 */
interface ValidationIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** zod の失敗を §10.3 の `details`（フィールドごとの理由）に写す。 */
function toValidationDetails(
  issues: readonly ValidationIssue[],
): { path: string; message: string }[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/**
 * JSON ボディの zod 検証。失敗時は §10.3 の統一エラー形式（VALIDATION_ERROR）で返す。
 * ApiException を投げて errorHandler に変換させる。
 */
export function jsonValidator<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "入力内容に誤りがあります。",
        toValidationDetails(result.error.issues),
      );
    }
  });
}

/**
 * クエリ文字列の zod 検証（`?limit=50&cursor=...`）。失敗時の形は {@link jsonValidator} と同じ。
 * 値は必ず文字列で来るので、スキーマ側で `z.coerce` を使う（`paginationQuerySchema`）。
 */
export function queryValidator<T extends ZodType>(schema: T) {
  return zValidator("query", schema, (result) => {
    if (!result.success) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "クエリパラメータに誤りがあります。",
        toValidationDetails(result.error.issues),
      );
    }
  });
}
