/**
 * レジストリ日時 → UTC の正規化（#289）。
 *
 * 両レジストリ（kitaqsign / kitaqnic）は日時を **JST の壁時計値**で返す。
 * kitaqnic の `reDate` / `acDate` は `Z` 付き、Poll の `qdate` はオフセット無しだが、
 * どちらも中身は JST（`docs/registry/kitaqnic/CHANGELOG.md` /
 * `docs/registry/kitaqsign/CHANGELOG.md` の実測。`Z` は信用できない）。
 * そのため付いているオフセット表記は**無視**し、壁時計成分を JST として UTC に直す。
 *
 * kitaq アダプタ専用。mock アダプタは真の UTC（`toISOString()`）を返すので通さないこと
 * （通すと -9h 化けする）。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 壁時計成分の抽出。桁の形だけを見る（値域の妥当性はレジストリ応答を信頼する）。
 * 秒未満は任意精度（kitaqnic の `qdate` はマイクロ秒 6 桁）、
 * 末尾は `Z` / `±HH:MM` / `±HHMM` / 無し のいずれも受けるが、値としては使わない。
 */
const WALL_CLOCK_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * レジストリが返した日時文字列を UTC の ISO 8601 に正規化する。
 *
 * 日時の形でない文字列は**変換せずそのまま返す**: 1 フィールドの想定外で
 * 応答全体を落とさない方針（`kitaq.ts` の `loosePayloadString` と同じ）に合わせ、
 * 読めなかった値は下流の `new Date()` 側の NaN ガードに委ねる。
 */
export function kitaqDatetimeToUtc(value: string): string {
  const matched = WALL_CLOCK_PATTERN.exec(value);
  if (matched === null) {
    return value;
  }
  const [, year, month, day, hour, minute, second, fraction] = matched;
  // 秒未満はミリ秒に切り捨てる（JS Date の精度）
  const ms = fraction === undefined ? 0 : Number(`${fraction}000`.slice(0, 3));
  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    ms,
  );
  return new Date(wallClock - JST_OFFSET_MS).toISOString();
}
