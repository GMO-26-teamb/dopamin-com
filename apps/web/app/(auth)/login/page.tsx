"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  loginWithPasskey,
  toAuthErrorMessage,
} from "@/lib/webauthn";

export default function LoginPage() {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  const onLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey();
      router.push("/dashboard");
    } catch (e) {
      setError(toAuthErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-semibold text-2xl">ログイン</h1>
      {supported ? (
        <>
          {/* テキスト入力欄は置かない（AC-01-2）。どのパスキーで入るかは OS のダイアログで選ぶ */}
          <button
            type="button"
            onClick={onLogin}
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white transition-opacity disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "認証中…" : "パスキーでログイン"}
          </button>
          {error && (
            <p className="text-red-600 text-sm dark:text-red-400">{error}</p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            初めての方は{" "}
            <Link href="/signup" className="underline">
              アカウント作成
            </Link>
          </p>
        </>
      ) : (
        <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
          お使いのブラウザはパスキーに対応していません。Chrome / Safari / Edge
          の最新版をご利用ください。
        </p>
      )}
    </main>
  );
}
