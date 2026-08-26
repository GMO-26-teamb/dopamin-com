import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { ApiException } from "./errors";

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
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
  });
}
