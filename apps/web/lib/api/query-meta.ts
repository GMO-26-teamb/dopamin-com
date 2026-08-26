/**
 * `useQuery` の `meta` に載せる印（fe-ui 設計 §4.5 の補足）。
 *
 * `createQueryClient`（query-client.tsx）は http モードで 401 を受けると
 * `/login?reason=expired` へ送る（ui-screens §1・S-03）。しかし「ログイン済みかどうかを
 * 確かめるだけ」のクエリ（S-00 / S-02 の `SignedInRedirect`）では 401 = 未ログインの正常系なので、
 * この印を付けて誘導を抑止する。`hooks.ts` の `useMe({ probe: true })` が使う。
 */

export const ALLOW_UNAUTHORIZED_META = { allowUnauthorized: true } as const;

export function allowsUnauthorized(
  meta: Record<string, unknown> | undefined,
): boolean {
  return meta?.allowUnauthorized === true;
}
