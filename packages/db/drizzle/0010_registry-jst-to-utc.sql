-- #289: 両レジストリ（kitaqsign / kitaqnic）が JST の壁時計値を UTC（`Z` 付き）と称して
-- 返す日時を無変換で取り込んでいたため、レジストリ由来の日時列が +9 時間ずれている
-- （docs/registry/*/CHANGELOG.md の 2026-08-28 エントリ）。
-- 新規の書き込みはアダプタの正規化（packages/registry/src/kitaq-datetime.ts）で直るが、
-- transfers の確定済み行はどの経路でも直らず、domains も次回 sync までずれたままなので是正する。
--
-- 「確実にずれている行」だけを対象にする: どちらのテーブルも行は登録・移管申請の直後に
-- 作られるため、レジストリ由来の日時が行作成時刻より 1 時間以上未来なのは +9h ずれ以外にない。
-- 修正版デプロイ後の sync / 再申請で既に直った行はこの条件に合わず、二重に -9h する事故は
-- 起きない（コードデプロイとマイグレーション適用の順序に依存しない）。
-- 取り残しうるのは「真の登録から 9 時間以内に移管 IN で取り込んだ行」の registered_at だが、
-- そちらは次回 sync の info 上書きで直る側なので任せる。NULL の列は NULL のまま（NULL 伝播）。
UPDATE "domains"
SET
  "registered_at" = "registered_at" - interval '9 hours',
  "expires_at" = "expires_at" - interval '9 hours',
  "last_transfer_at" = "last_transfer_at" - interval '9 hours'
WHERE "registry" IN ('kitaqsign', 'kitaqnic')
  AND "registered_at" > "created_at" + interval '1 hour';
--> statement-breakpoint
-- transfers でずれているのは kitaqnic × IN だけ（kitaqsign は reDate / acDate を返さず
-- サーバ時刻フォールバックで正しく、kitaqnic の OUT も Poll payload に reDate が無い。
-- #289 の本番実測: 全 22 行中ずれは kitaqnic × in の 4 行のみ）
UPDATE "transfers"
SET
  "requested_at" = "requested_at" - interval '9 hours',
  "act_by_at" = "act_by_at" - interval '9 hours'
WHERE "registry" = 'kitaqnic'
  AND "direction" = 'in'
  AND "requested_at" > "created_at" + interval '1 hour';
