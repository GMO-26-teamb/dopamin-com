import { describe, expect, it } from "vitest";
import { kitaqDatetimeToUtc } from "./kitaq-datetime";

/**
 * レジストリ日時 → UTC の正規化（#289）。
 *
 * 両レジストリ（kitaqsign / kitaqnic）は日時を JST の壁時計値で返す。
 * kitaqnic の `reDate` / `acDate` は `Z` 付きで返るが中身は JST、Poll の `qdate` は
 * オフセット無し（`docs/registry/kitaqnic/CHANGELOG.md` の実測）。
 * どちらも壁時計値を JST と解釈して UTC に直すことを固定する。
 */
describe("kitaqDatetimeToUtc（JST 壁時計値 → UTC。#289）", () => {
  it("Z 付きでも中身を JST と解釈して -9h する（kitaqnic reDate の実測形）", () => {
    // 実測: dopamin-trin-ok.xyz / svTRID KQNIC-20260828-017291。
    // レジストリは "14:30:57Z" と称するが実際は JST 14:30:57（= UTC 05:30:57）
    expect(kitaqDatetimeToUtc("2026-08-28T14:30:57Z")).toBe(
      "2026-08-28T05:30:57.000Z",
    );
  });

  it("オフセット無しの naive 形も JST と解釈する（kitaqnic qdate の実測形）", () => {
    // マイクロ秒精度はミリ秒に切り捨てる（JS Date の精度）
    expect(kitaqDatetimeToUtc("2026-08-28T14:29:05.259522")).toBe(
      "2026-08-28T05:29:05.259Z",
    );
  });

  it("+09:00 等のオフセット表記も信用せず、壁時計値を JST と解釈する", () => {
    expect(kitaqDatetimeToUtc("2026-08-28T14:30:57+09:00")).toBe(
      "2026-08-28T05:30:57.000Z",
    );
    expect(kitaqDatetimeToUtc("2026-08-28T14:30:57+0900")).toBe(
      "2026-08-28T05:30:57.000Z",
    );
  });

  it("JST 00:00〜08:59 の値は暦日が 1 日戻る（AC-02-2 の残日数ずれの原因）", () => {
    expect(kitaqDatetimeToUtc("2026-08-28T08:59:59Z")).toBe(
      "2026-08-27T23:59:59.000Z",
    );
  });

  it("ミリ秒精度はそのまま保つ", () => {
    expect(kitaqDatetimeToUtc("2026-08-28T14:30:57.123Z")).toBe(
      "2026-08-28T05:30:57.123Z",
    );
  });

  it("日時の形でない文字列は変換せずそのまま返す（応答全体を落とさない）", () => {
    expect(kitaqDatetimeToUtc("not-a-date")).toBe("not-a-date");
    // 日付のみは時刻の壁時計解釈が定まらないので触らない
    expect(kitaqDatetimeToUtc("2026-08-28")).toBe("2026-08-28");
    expect(kitaqDatetimeToUtc("")).toBe("");
  });
});
