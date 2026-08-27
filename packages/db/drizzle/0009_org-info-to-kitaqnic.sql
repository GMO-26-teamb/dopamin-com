-- 2026-08-27 の仕様変更: .org / .info の管轄が kitaqsign → kitaqnic へ移管された
-- （docs/registry/kitaqnic/CHANGELOG.md）。レジストリ側でデータごと引き継がれるため、
-- アプリ側も既存行の registry を付け替える。ルーティング自体は TLD 表
-- （packages/shared/src/tlds.ts）で引くので、この UPDATE は表示・記録の整合のため。
UPDATE "domains"
SET "registry" = 'kitaqnic'
WHERE "registry" = 'kitaqsign'
  AND "tld" IN ('org', 'info');
--> statement-breakpoint
UPDATE "transfers"
SET "registry" = 'kitaqnic'
WHERE "registry" = 'kitaqsign'
  AND ("domain_name" LIKE '%.org' OR "domain_name" LIKE '%.info');
