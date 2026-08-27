import { domainNameSchema } from "@dopamin/shared";
import { ApiException } from "./errors";

/**
 * パスパラメータの検証。所有権チェック（`requireOwnedDomain`）より先に呼び、
 * 形式が不正な値は DB を引く前に 400 で弾く（NFR-05）。
 */
export function parseDomainNameParam(raw: string): string {
  const parsed = domainNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiException("VALIDATION_ERROR", "ドメイン名の形式が不正です。");
  }
  return parsed.data;
}
