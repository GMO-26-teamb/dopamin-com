import { domainNameSchema, SUPPORTED_TLDS, sldSchema } from "@dopamin/shared";

/**
 * 対応 TLD 22 種（kitaqsign 4 + kitaqnic 18）。正は `@dopamin/shared` の
 * `REGISTRY_TLDS` / `SUPPORTED_TLDS`（`GET /sessions/hello` で確定済み。§11.2）。
 *
 * `POST /domains/check` の `tlds` は最大 22 件（`domainCheckRequestSchema`）なので、
 * 全選択がちょうど上限と一致する（ui-screens S-20 / S-24「TLD 22 種を一括確認」）。
 */
export { SUPPORTED_TLDS };

/** 希望 TLD の既定値 = 全対応 TLD（ui-screens S-20 / S-24）。 */
export const DEFAULT_TLDS: readonly string[] = SUPPORTED_TLDS;

/** 全対応 TLD が選ばれている（= 絞り込んでいない）か。 */
export function isAllTlds(tlds: readonly string[]): boolean {
  return tlds.length === SUPPORTED_TLDS.length;
}

/**
 * 直接検索の入力（ui-screens S-24）。
 * `.` を含む場合は FQDN として 1 件だけ check し、含まない場合は SLD × 選択 TLD を一括で check する。
 */
export type SearchQuery =
  | { kind: "fqdn"; name: string }
  | { kind: "sld"; sld: string };

export type ParseResult =
  | { ok: true; query: SearchQuery }
  | { ok: false; message: string };

const SLD_ERROR = "英数字とハイフンだけを使い、63 文字以内で入力してください";
const FQDN_ERROR = "ドメイン名の形式が不正です（例: takutaku.com）";

/** TLD を 1 つも選ばずに一括確認しようとしたとき（`tlds` は最小 1 件）。 */
export const TLD_REQUIRED = "TLD を 1 つ以上選んでください";

/**
 * 入力欄の文字列を検証して SLD / FQDN に振り分ける（AC-03-3）。
 * 不正な文字列はレジストリに送らず、ここで弾く。
 */
export function parseSearchQuery(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "ドメイン名を入力してください" };
  }

  if (trimmed.includes(".")) {
    const parsed = domainNameSchema.safeParse(trimmed);
    return parsed.success
      ? { ok: true, query: { kind: "fqdn", name: parsed.data } }
      : { ok: false, message: FQDN_ERROR };
  }

  const parsed = sldSchema.safeParse(trimmed);
  return parsed.success
    ? { ok: true, query: { kind: "sld", sld: parsed.data } }
    : { ok: false, message: SLD_ERROR };
}
