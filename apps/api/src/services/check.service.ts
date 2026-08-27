import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import {
  type DomainCheckResult,
  type DomainUniqueness,
  getDefaultPreparedCorpus,
  scoreDistinctiveness,
  splitDomainName,
  toDomainUniqueness,
} from "@dopamin/shared";
import { getRegistrySet } from "../lib/registries";
import { withReadRetry } from "../lib/retry";

/**
 * 空き確認（docs/requirements.md FR-03 / §10.4）と独自性スコア（FR-05）の付与。
 *
 * `POST /domains/check` と `POST /ai/domain-candidates`（FR-04）の両方が使う。
 * 部分失敗を許容する（AC-03-2）: 一方のレジストリが落ちていても他方の結果は返し、
 * 落ちた行は `availability: "error"` + `error` で表す。
 */

/**
 * FR-05: SLD の独自性スコアを計算する（呼び出し 1 回のなかで SLD ごとにメモ化）。
 * スコア計算は check 本体の付随情報なので、失敗しても check 結果は返す。
 */
export function createUniquenessResolver(): (
  name: string,
) => DomainUniqueness | null {
  const bySld = new Map<string, DomainUniqueness | null>();
  return (name) => {
    try {
      const { sld } = splitDomainName(name);
      let u = bySld.get(sld);
      if (u === undefined) {
        u = toDomainUniqueness(
          scoreDistinctiveness(sld, getDefaultPreparedCorpus()),
        );
        bySld.set(sld, u);
      }
      return u;
    } catch {
      return null;
    }
  };
}

/** レジストリ呼び出しが丸ごと失敗したときの、行に載せるエラー。 */
function checkFailure(err: unknown): NonNullable<DomainCheckResult["error"]> {
  return err instanceof RegistryError
    ? { code: err.code, message: "レジストリへの確認に失敗しました。" }
    : { code: "INTERNAL", message: "空き確認に失敗しました。" };
}

/**
 * FQDN 群の空き確認。レジストリごとにまとめて 1 回ずつ問い合わせ、
 * 入力と同じ順・同じ件数（重複は除去済み）で結果を返す。
 *
 * 独自性スコア（FR-05）はインメモリの lexical 計算なのでレジストリ通信と独立して付く
 * （AC-05-2。ADR-0003）。`available` 以外の行に付けるかは §10.4 の例に合わせて分岐する。
 */
export async function checkDomains(
  names: readonly string[],
): Promise<DomainCheckResult[]> {
  const uniqueNames = [...new Set(names)];
  const uniquenessFor = createUniquenessResolver();

  const registrySet = getRegistrySet();
  const groups = new Map<
    string,
    { adapter: RegistryAdapter; names: string[] }
  >();
  const resultByName = new Map<string, DomainCheckResult>();

  for (const name of uniqueNames) {
    const adapter = registrySet.forDomain(name);
    if (!adapter) {
      resultByName.set(name, {
        name,
        registry: null,
        availability: "error",
        uniqueness: null,
        error: { code: "VALIDATION_ERROR", message: "未対応の TLD です。" },
      });
      continue;
    }
    const group = groups.get(adapter.id) ?? { adapter, names: [] };
    group.names.push(name);
    groups.set(adapter.id, group);
  }

  await Promise.all(
    [...groups.values()].map(async ({ adapter, names: groupNames }) => {
      try {
        // §11.6 (e): 参照系は繋がらないときだけ最大 2 回まで自動再試行する
        const results = await withReadRetry(() => adapter.check(groupNames));
        const byName = new Map(results.map((r) => [r.name, r]));
        for (const name of groupNames) {
          const result = byName.get(name);
          if (result) {
            resultByName.set(name, {
              name,
              registry: adapter.id,
              availability: result.available ? "available" : "unavailable",
              ...(result.reason ? { reason: result.reason } : {}),
              // FR-05: 独自性スコアは「空き」のときだけ意味を持つ（§10.4 の例に準拠）
              uniqueness: result.available ? uniquenessFor(name) : null,
            });
          } else {
            resultByName.set(name, {
              name,
              registry: adapter.id,
              availability: "error",
              // AC-05-2: スコア算出はレジストリ通信と独立しているので、
              // check が失敗した行でもスコアは返す（ui-screens §Unknown バリアント）
              uniqueness: uniquenessFor(name),
              error: {
                code: "REGISTRY_SPEC_MISMATCH",
                message: "check の結果に対象ドメインが含まれていません。",
              },
            });
          }
        }
      } catch (err) {
        // 一方のレジストリが落ちていても他方の結果は返す（部分失敗の許容）
        const error = checkFailure(err);
        for (const name of groupNames) {
          resultByName.set(name, {
            name,
            registry: adapter.id,
            availability: "error",
            // AC-05-2: レジストリ障害時もスコアは表示する
            uniqueness: uniquenessFor(name),
            error,
          });
        }
      }
    }),
  );

  return uniqueNames.flatMap((name) => {
    const item = resultByName.get(name);
    return item ? [item] : [];
  });
}
