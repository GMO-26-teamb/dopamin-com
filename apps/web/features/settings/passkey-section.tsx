"use client";

import type { PasskeySummary } from "@dopamin/shared";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAddPasskey, useDeletePasskey, usePasskeys } from "@/lib/api/hooks";
import { toErrorCopy } from "@/lib/error-messages";
import { DeletePasskeyDialog } from "./delete-passkey-dialog";
import { formatPasskeyMeta, passkeyName } from "./format";
import type { NotifySettings } from "./notice";

/**
 * Figma: S-70 `85:6709`（Card kicker「パスキー管理」）/ D-09 `85:6745`
 * FR-01 のパスキー一覧・追加・削除。最後の 1 つは削除ボタンを Disabled にする
 * （API も 409 を返す。ui-screens §2.8）。
 */

/** 骨組みの行数（fixtures のパスキー 2 件に合わせる） */
const SKELETON_ROWS = ["passkey-1", "passkey-2"] as const;

export interface PasskeySectionProps {
  onNotify: NotifySettings;
}

export function PasskeySection({ onNotify }: PasskeySectionProps) {
  const passkeys = usePasskeys();
  const addPasskey = useAddPasskey();
  const deletePasskey = useDeletePasskey();
  const [target, setTarget] = useState<PasskeySummary | null>(null);

  const handleAdd = () => {
    deletePasskey.reset();
    addPasskey.mutate(undefined, {
      onSuccess: (created) => {
        onNotify({
          tone: "ok",
          title: "パスキーを追加しました",
          body: `${passkeyName(created)} でログインできます。`,
        });
      },
      onError: (error) => {
        // S-70b: 追加失敗は Banner Warn（WebAuthn のキャンセルもここに来る）
        onNotify({
          tone: "warn",
          title: "パスキーを追加できませんでした",
          body: toErrorCopy(error).body,
        });
      },
    });
  };

  const handleDelete = () => {
    if (target === null) return;
    const name = passkeyName(target);
    deletePasskey.mutate(target.id, {
      onSuccess: () => {
        setTarget(null);
        onNotify({
          tone: "ok",
          title: "パスキーを削除しました",
          body: `${name} を削除しました。`,
        });
      },
      // 409（最後の 1 つ）などは D-09 を閉じて Error Card に出す（ui-screens §4）
      onError: () => setTarget(null),
    });
  };

  const addButton = (
    <Button
      leadingIcon={<Plus />}
      loading={addPasskey.isPending}
      onClick={handleAdd}
      variant="outline"
    >
      パスキーを追加
    </Button>
  );

  return (
    <Card kicker="パスキー管理">
      {passkeys.isPending ? (
        <PasskeySkeleton />
      ) : passkeys.error ? (
        <ErrorCard
          error={passkeys.error}
          onRetry={() => {
            void passkeys.refetch();
          }}
        />
      ) : passkeys.data.length === 0 ? (
        <EmptyState
          body="パスキーを追加すると、次回から生体認証や PIN だけでログインできます。"
          primary={addButton}
          title="パスキーがありません"
        />
      ) : (
        <>
          {passkeys.data.map((passkey) => (
            <PasskeyRow
              busy={deletePasskey.isPending}
              isLast={passkeys.data.length === 1}
              key={passkey.id}
              onDelete={() => {
                addPasskey.reset();
                deletePasskey.reset();
                setTarget(passkey);
              }}
              passkey={passkey}
            />
          ))}
          {deletePasskey.error ? (
            <ErrorCard error={deletePasskey.error} />
          ) : null}
          <div className="flex w-full">{addButton}</div>
        </>
      )}

      <DeletePasskeyDialog
        busy={deletePasskey.isPending}
        onConfirm={handleDelete}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        open={target !== null}
        passkeyName={target === null ? "" : passkeyName(target)}
      />
    </Card>
  );
}

function PasskeySkeleton() {
  return (
    <div aria-busy="true" className="flex w-full flex-col gap-2">
      {SKELETON_ROWS.map((key) => (
        <Skeleton className="h-7" key={key} shape="block" />
      ))}
      <Skeleton className="w-37" shape="block" />
    </div>
  );
}

interface PasskeyRowProps {
  passkey: PasskeySummary;
  isLast: boolean;
  busy: boolean;
  onDelete: () => void;
}

function PasskeyRow({ passkey, isLast, busy, onDelete }: PasskeyRowProps) {
  const name = passkeyName(passkey);

  return (
    <div className="flex w-full items-center gap-2">
      <KeyRound aria-hidden="true" className="size-3.5 shrink-0 text-ink" />
      <span className="shrink-0 text-body-sm text-ink">{name}</span>
      <span className="min-w-0 flex-1 truncate text-caption text-muted">
        {formatPasskeyMeta(passkey)}
      </span>
      <Button
        aria-label={`${name} のパスキーを削除`}
        disabled={isLast || busy}
        onClick={onDelete}
        size="sm"
        variant="outline"
      >
        {isLast ? "削除（最後の1つは不可）" : "削除"}
      </Button>
    </div>
  );
}
