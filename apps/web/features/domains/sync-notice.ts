import type { RegistryId } from "@dopamin/shared";
import type { ApiClientError } from "@/lib/api/errors";
import type { DomainSummary, SyncFailure } from "@/lib/api/types";
import { REGISTRY_LABEL } from "./registry-label";

/**
 * S-13 の同期エラー Banner（FR-02 / AC-18-1）の文言。
 *
 * Next.js の Page モジュールは `default` と決められたメタデータ以外を export できないため
 * （`auto-sync.ts` と同じ制約）、純粋関数はここに置いてテストもここから読む。
 */

export interface SyncNotice {
  title: string;
  body: string;
}

export interface SyncNoticeInput {
  /** リクエスト自体が失敗したとき（401 / 5xx / ネットワーク）。部分失敗ではない。 */
  error: ApiClientError | null;
  /** 200 で返った部分失敗（S-13 の本命）。 */
  failures: readonly SyncFailure[];
  /** 現在表示している一覧。落ちた相手を特定する最後の手がかりに使う。 */
  domains: readonly DomainSummary[];
}

/**
 * 落ちたレジストリを特定する。
 * `failures` が名指ししていればそれが正、無ければエラー、それも無ければ stale なカードから推定する。
 */
function downRegistries(input: SyncNoticeInput): RegistryId[] {
  const fromFailures = new Set<RegistryId>(
    input.failures.flatMap((failure) =>
      failure.registry === null ? [] : [failure.registry],
    ),
  );
  if (fromFailures.size > 0) {
    return [...fromFailures];
  }
  if (input.error?.registry !== undefined) {
    return [input.error.registry];
  }
  return [
    ...new Set(
      input.domains
        .filter((domain) => domain.stale)
        .map((domain) => domain.registry),
    ),
  ];
}

/** 「Kitaqsign が応答しません」の主語。特定できなければ総称にする。 */
function subjectOf(registries: readonly RegistryId[]): string {
  if (registries.length >= 2) {
    return "両レジストリ";
  }
  const only = registries[0];
  return only === undefined ? "レジストリ" : REGISTRY_LABEL[only];
}

function titleFor(registries: readonly RegistryId[]): string {
  const subject = subjectOf(registries);
  // 英字のレジストリ名のときだけ和文との間に半角スペースを入れる
  const separator = /[A-Za-z0-9]$/.test(subject) ? " " : "";
  return `${subject}${separator}が応答しません — 一覧はキャッシュを表示しています`;
}

/**
 * 同期の結果から Banner を作る。出す必要が無ければ null。
 *
 * 部分失敗（`failures`）とリクエストごとの失敗（`error`）の両方をここで扱う。
 * 部分失敗のときだけ「n 件が最新化できませんでした」を添えて、
 * 一覧の一部だけが古いことを明示する。
 *
 * 「最終同期 n 分前」は Banner に書かない。S-13 では stale なカード自身が
 * 「最終同期 n 分前」を持ち、ヘッダーメタも一覧全体の最終同期を出すので、
 * Banner にもう 1 つ別の基準の時刻を並べると値が食い違って見える。
 */
export function syncNotice(input: SyncNoticeInput): SyncNotice | null {
  const failureCount = input.failures.length;
  if (input.error === null && failureCount === 0) {
    return null;
  }

  const partial =
    failureCount === 0 ? "" : `${failureCount} 件が最新化できませんでした。`;

  return {
    title: titleFor(downRegistries(input)),
    body: `${partial}参照系は自動で 2 回再試行しました。しばらくして「最新化」を押してください。`,
  };
}
