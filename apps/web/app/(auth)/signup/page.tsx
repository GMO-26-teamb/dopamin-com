import { SignupScreen } from "@/features/auth/signup-screen";

/**
 * S-01 / S-01b / S-01c（`/signup`）。
 * `?next=` はサーバー側で読んでクライアントに渡す（`/login` と同じ理由）。
 */
export default async function SignupPage(props: PageProps<"/signup">) {
  const params = await props.searchParams;
  const next = typeof params.next === "string" ? params.next : null;

  return <SignupScreen next={next} />;
}
