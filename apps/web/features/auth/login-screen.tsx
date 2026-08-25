"use client";

/**
 * Figma: S-02 `80:168` / S-02b `80:179` / S-02c `93:7710` / S-03 `80:209`
 *
 * ログイン（FR-01）。テキスト入力欄は置かない（AC-01-2）— どのパスキーで入るかは
 * OS / ブラウザのダイアログが選ぶ。成功したら `?next=` か `/dashboard` へ戻る（AC-01-3）。
 */

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AuthCard } from "./auth-card";
import { nextPathOrDefault, safeNextPath, withNext } from "./next-path";
import { SignedInRedirect } from "./signed-in-redirect";
import { UNSUPPORTED_BODY, UNSUPPORTED_TITLE } from "./unsupported-copy";
import { usePasskeyAuth } from "./use-passkey";

export interface LoginScreenProps {
  /** `?next=`。検証は `safeNextPath` が行う */
  next: string | null;
  /** `?reason=expired`（S-03） */
  expired: boolean;
}

export function LoginScreen({ next, expired }: LoginScreenProps) {
  const router = useRouter();
  const { support, pending, failed, login } = usePasskeyAuth();
  const target = nextPathOrDefault(next);
  const safeNext = safeNextPath(next);

  const onLogin = async () => {
    if (await login()) {
      router.replace(target);
    }
  };

  const footer = (
    <>
      はじめての方 →{" "}
      <Link
        className="text-link underline hover:text-link-hover"
        href={withNext("/signup", safeNext)}
      >
        新規登録
      </Link>
    </>
  );

  // S-02c: フォールバック認証は提供しないのでボタンごと出さない
  if (support === "unsupported") {
    return (
      <AuthCard>
        <EmptyState
          body={UNSUPPORTED_BODY}
          title={UNSUPPORTED_TITLE}
          tone="warn"
        />
      </AuthCard>
    );
  }

  return (
    <>
      <SignedInRedirect to={target} />
      <AuthCard
        banner={
          <LoginBanner expired={expired} failed={failed} next={safeNext} />
        }
        footer={footer}
        note="ユーザー名の入力は不要。ブラウザがパスキーを選びます。"
        title="おかえり"
      >
        <Button
          className="w-full justify-center"
          leadingIcon={<KeyRound />}
          loading={pending}
          onClick={() => void onLogin()}
          size="lg"
          variant="primary"
        >
          {pending ? "認証中…" : "パスキーでログイン"}
        </Button>
      </AuthCard>
    </>
  );
}

/** バナーはメイン先頭に 1 つだけ（ui-screens §1）。直近の失敗を優先する。 */
function LoginBanner({
  expired,
  failed,
  next,
}: {
  expired: boolean;
  failed: boolean;
  next: string | null;
}) {
  if (failed) {
    // S-02b: キャンセル / パスキー不在 / signature counter 後退（AC-01-4）を同一文言で扱う
    return (
      <Banner
        body="パスキーが見つからないか、キャンセルされました。はじめての方は新規登録へ。"
        title="ログインできませんでした"
        tone="warn"
      />
    );
  }
  if (expired) {
    // S-03: API 401 からの復帰
    return (
      <Banner
        body={
          next === null
            ? "安全のため、もう一度ログインしてください。"
            : `安全のため、もう一度ログインしてください。ログイン後は元のページ（${next}）に戻ります。`
        }
        title="セッションの有効期限が切れました"
        tone="info"
      />
    );
  }
  return null;
}
