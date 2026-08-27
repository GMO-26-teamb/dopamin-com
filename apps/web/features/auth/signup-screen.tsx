"use client";

/**
 * Figma: S-01 `80:40` / S-01b `80:52` / S-01c `80:92`
 *
 * サインアップ（FR-01）。入力は表示名だけ（1〜32 文字。クライアントとサーバーの両方で弾く）。
 * 成功したら `?next=` か `/dashboard`（初回はドメイン 0 件 = S-11）へ進む。
 */

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { AuthCard } from "./auth-card";
import { nextPathOrDefault, safeNextPath, withNext } from "./next-path";
import { SignedInRedirect } from "./signed-in-redirect";
import { UNSUPPORTED_BODY, UNSUPPORTED_TITLE } from "./unsupported-copy";
import { DISPLAY_NAME_MAX, usePasskeyAuth } from "./use-passkey";

export interface SignupScreenProps {
  /** `?next=`。検証は `safeNextPath` が行う */
  next: string | null;
}

export function SignupScreen({ next }: SignupScreenProps) {
  const router = useRouter();
  const { support, pending, failed, fieldError, signup, clearErrors } =
    usePasskeyAuth();
  const [displayName, setDisplayName] = useState("");
  const target = nextPathOrDefault(next);
  const safeNext = safeNextPath(next);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await signup(displayName)) {
      router.replace(target);
    }
  };

  const footer = (
    <>
      アカウントがある →{" "}
      <Link
        className="text-link underline hover:text-link-hover"
        href={withNext("/login", safeNext)}
      >
        パスキーでログイン
      </Link>
    </>
  );

  // S-01c: フォールバック認証は提供しないのでフォームごと出さない
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
          failed ? (
            // S-01b: キャンセル / タイムアウト / 非対応を同一文言で扱う
            <Banner
              body="ブラウザで作成がキャンセルされたか、この端末が対応していません。もう一度お試しください。"
              title="パスキーを作成できませんでした"
              tone="warn"
            />
          ) : null
        }
        footer={footer}
        note="生体認証または PIN を使います。パスワードは作りません。"
        title="はじめる"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => void onSubmit(e)}
        >
          <Input
            autoComplete="nickname"
            error={fieldError ?? undefined}
            label={`表示名（1〜${DISPLAY_NAME_MAX} 文字）`}
            maxLength={DISPLAY_NAME_MAX}
            name="displayName"
            onChange={(event) => {
              setDisplayName(event.target.value);
              clearErrors();
            }}
            placeholder="たくたく"
            value={displayName}
          />
          <Button
            className="w-full justify-center"
            leadingIcon={<KeyRound />}
            loading={pending}
            size="lg"
            type="submit"
            variant="primary"
          >
            {pending ? "作成中…" : "パスキーを作成"}
          </Button>
        </form>
      </AuthCard>
    </>
  );
}
