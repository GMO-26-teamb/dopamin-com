"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  signupWithPasskey,
  toAuthErrorMessage,
} from "@/lib/webauthn";

export default function SignupPage() {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signupWithPasskey(displayName.trim());
      router.push("/dashboard");
    } catch (err) {
      setError(toAuthErrorMessage(err));
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
          お使いのブラウザはパスキーに対応していません。Chrome / Safari / Edge
          の最新版をご利用ください。
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-semibold text-2xl">アカウント作成</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        メールアドレスもパスワードも不要。表示名だけで始められます。
      </p>
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          表示名（1〜32 文字）
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            minLength={1}
            maxLength={32}
            required
            autoComplete="nickname"
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            placeholder="たとえば: たくたく"
          />
        </label>
        <button
          type="submit"
          disabled={busy || displayName.trim().length === 0}
          className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white transition-opacity disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "作成中…" : "パスキーを作成してはじめる"}
        </button>
        {error && (
          <p className="text-red-600 text-sm dark:text-red-400">{error}</p>
        )}
      </form>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        アカウントをお持ちの方は{" "}
        <Link href="/login" className="underline">
          ログイン
        </Link>
      </p>
    </main>
  );
}
