import { domainNameSchema, sldSchema } from "@dopamin/shared";
import type { SelectOption } from "@/components/ui/select";

/**
 * 一括確認の対象 TLD（ui-screens S-20 / S-24「TLD 22 種を一括確認」）。
 * `POST /domains/check` の `tlds` は最大 22 件（`domainCheckRequestSchema`）なので、
 * ここが上限とちょうど一致する。
 */
export const SUPPORTED_TLDS = [
  "com",
  "net",
  "org",
  "info",
  "biz",
  "dev",
  "app",
  "xyz",
  "online",
  "site",
  "tech",
  "space",
  "store",
  "fun",
  "shop",
  "blog",
  "cloud",
  "page",
  "live",
  "studio",
  "works",
  "world",
] as const;

/** Select の「すべて」を表す番兵。TLD は英字のみなので実在の値とは衝突しない。 */
export const ALL_TLDS = "*";

export const TLD_OPTIONS: readonly SelectOption[] = [
  { value: ALL_TLDS, label: `すべて（${SUPPORTED_TLDS.length} 種）` },
  ...SUPPORTED_TLDS.map((tld) => ({ value: tld, label: `.${tld}` })),
];

/** Select の値（`*` またはひとつの TLD）を check に渡す TLD 配列にする。 */
export function resolveTlds(value: string): string[] {
  return value === ALL_TLDS ? [...SUPPORTED_TLDS] : [value];
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

const SLD_ERROR =
  "英数字とハイフンのみ、1〜63 文字で入力してください（RFC 1035）";
const FQDN_ERROR = "ドメイン名の形式が不正です（例: takutaku.com）";

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
