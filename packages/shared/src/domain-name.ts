import { z } from "zod";

/** RFC 1035 準拠のラベル: 英数字とハイフン、先頭末尾ハイフン不可、1〜63 文字。IDN 非対応（FR-03）。 */
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidLabel(label: string): boolean {
  return LABEL_PATTERN.test(label);
}

/** SLD（例: `example`）。小文字に正規化する。 */
export const sldSchema = z
  .string()
  .min(1)
  .max(63)
  .transform((v) => v.toLowerCase())
  .refine(isValidLabel, {
    message: "SLD は英数字とハイフンのみ（先頭・末尾のハイフン不可）です",
  });

/** TLD（例: `com`。ドットなし）。小文字に正規化する。 */
export const tldSchema = z
  .string()
  .min(2)
  .max(63)
  .transform((v) => v.toLowerCase())
  .refine((v) => /^[a-z]+$/.test(v), { message: "TLD の形式が不正です" });

/** FQDN（例: `example.com`）。全体 253 文字以内、各ラベルが RFC 1035 準拠であること。 */
export const domainNameSchema = z
  .string()
  .min(1)
  .max(253)
  .transform((v) => v.toLowerCase())
  .refine(
    (v) => {
      const labels = v.split(".");
      return labels.length >= 2 && labels.every(isValidLabel);
    },
    { message: "ドメイン名の形式が不正です" },
  );

/** ネームサーバ等のホスト名（FQDN、最大 255 文字）。 */
export const hostNameSchema = z
  .string()
  .min(1)
  .max(255)
  .transform((v) => v.toLowerCase())
  .refine(
    (v) => {
      const labels = v.split(".");
      return labels.length >= 2 && labels.every(isValidLabel);
    },
    { message: "ホスト名の形式が不正です" },
  );

/** FQDN を SLD / TLD に分割する（TLD は最後のラベル）。 */
export function splitDomainName(name: string): { sld: string; tld: string } {
  const labels = name.toLowerCase().split(".");
  const tld = labels[labels.length - 1] ?? "";
  return { sld: labels.slice(0, -1).join("."), tld };
}
