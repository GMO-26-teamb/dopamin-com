import { LoginScreen } from "@/features/auth/login-screen";

/**
 * S-02 / S-02b / S-02c / S-03（`/login`）。
 *
 * `?next=` と `?reason=expired` はサーバー側で読んでクライアントに渡す。
 * `useSearchParams()` を使うとページ全体に Suspense 境界が要るため採らない
 * （`lib/api/provider.tsx` に同じ判断のメモがある）。
 */
export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const next = typeof params.next === "string" ? params.next : null;

  return <LoginScreen expired={params.reason === "expired"} next={next} />;
}
