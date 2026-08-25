"use client";

import type { PasskeySummary } from "@dopamin/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  addPasskey,
  deletePasskeyById,
  fetchPasskeys,
  toAuthErrorMessage,
} from "@/lib/webauthn";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP");
}

export default function PasskeysPage() {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPasskeys(await fetchPasskeys());
    } catch (e) {
      setError(toAuthErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onAdd = async () => {
    setBusy(true);
    setError(null);
    try {
      await addPasskey();
      await reload();
    } catch (e) {
      setError(toAuthErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("このパスキーを削除しますか？")) return;
    setError(null);
    try {
      await deletePasskeyById(id);
      await reload();
    } catch (e) {
      setError(toAuthErrorMessage(e));
    }
  };

  const lastOne = passkeys !== null && passkeys.length <= 1;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">パスキー管理</h1>
        <Link href="/dashboard" className="text-sm underline">
          ダッシュボードへ
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        パスキーを失うとアカウントを復旧する手段がありません。別のデバイスや同期パスキーの追加登録をおすすめします。
      </p>
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 font-medium text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "登録中…" : "パスキーを追加"}
      </button>
      {error && (
        <p className="text-red-600 text-sm dark:text-red-400">{error}</p>
      )}
      {passkeys === null ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  {p.name ?? "パスキー"}
                  {p.backedUp && (
                    <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      同期
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  作成: {formatDate(p.createdAt)} / 最終利用:{" "}
                  {formatDate(p.lastUsedAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDelete(p.id)}
                disabled={lastOne}
                title={lastOne ? "最後のパスキーは削除できません" : undefined}
                className="text-red-600 text-sm underline disabled:no-underline disabled:opacity-40 dark:text-red-400"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      {lastOne && (
        <p className="text-xs text-zinc-500">
          最後の 1 件は削除できません（ログイン手段が無くなるため）。
        </p>
      )}
    </main>
  );
}
