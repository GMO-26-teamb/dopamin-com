"use client";

import { type PasskeySummary, passkeyNameSchema } from "@dopamin/shared";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAddPasskey,
  useDeletePasskey,
  usePasskeys,
  useRenamePasskey,
} from "@/lib/api/hooks";
import { toErrorCopy } from "@/lib/error-messages";
import { DeletePasskeyDialog } from "./delete-passkey-dialog";
import { formatPasskeyMeta, passkeyName } from "./format";
import type { NotifySettings } from "./notice";

/**
 * Figma: S-70 `85:6709`（Card kicker「パスキー管理」）/ D-09 `85:6745`
 * FR-01 のパスキー一覧・追加・名前変更・削除。
 * - 名前変更は行のインライン編集（鉛筆 Icon Button → Input + 保存 / キャンセル、1〜32 文字。
 *   spec §8。Figma フレームは無く、S-70 の行に Input `46:110` を差し込む）
 * - 最後の 1 つは削除ボタンを Disabled にする（API も 409 を返す。ui-screens §2.8）。
 *   押せない理由はアクセシブルネームにだけ持たせ、文言を増やさない
 * - 追加・削除・名前変更の結果は自分では出さず、親の 1 本の面に投げる（notice.ts）
 */

/** 骨組みの行数（fixtures のパスキー 2 件に合わせる） */
const SKELETON_ROWS = ["passkey-1", "passkey-2"] as const;

/** クライアント側のバリデーション文言（ui-screens §4「バリデーション」。サーバーも同じ制約で弾く） */
export const PASSKEY_NAME_ERROR = "1〜32 文字で入力してください";

export interface PasskeySectionProps {
  onNotify: NotifySettings;
}

export function PasskeySection({ onNotify }: PasskeySectionProps) {
  const passkeys = usePasskeys();
  const addPasskey = useAddPasskey();
  const deletePasskey = useDeletePasskey();
  const renamePasskey = useRenamePasskey();
  const [target, setTarget] = useState<PasskeySummary | null>(null);
  /** 編集中の行（同時に 1 行だけ） */
  const [editingId, setEditingId] = useState<string | null>(null);

  /** 別の操作を始めるときに前の結果（Banner / Error Card）を消す */
  const resetMutations = () => {
    addPasskey.reset();
    deletePasskey.reset();
    renamePasskey.reset();
    onNotify(null);
  };

  const handleAdd = () => {
    resetMutations();
    addPasskey.mutate(undefined, {
      onSuccess: (created) => {
        onNotify({
          kind: "banner",
          tone: "ok",
          title: "パスキーを追加しました",
          body: `${passkeyName(created)} でログインできます。`,
        });
      },
      onError: (error) => {
        // S-70b: 追加失敗は Banner Warn（WebAuthn のキャンセルもここに来る）
        onNotify({
          kind: "banner",
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
          kind: "banner",
          tone: "ok",
          title: "パスキーを削除しました",
          body: `${name} を削除しました。`,
        });
      },
      // 409（最後の 1 つ）などは D-09 を閉じて Error Card に出す（ui-screens §4）
      onError: (error) => {
        setTarget(null);
        onNotify({ kind: "error", error });
      },
    });
  };

  const handleRename = (passkey: PasskeySummary, name: string) => {
    const previous = passkeyName(passkey);
    renamePasskey.mutate(
      { id: passkey.id, name },
      {
        onSuccess: (renamed) => {
          setEditingId(null);
          onNotify({
            kind: "banner",
            tone: "ok",
            title: "パスキーの名前を変更しました",
            body: `${previous} を ${passkeyName(renamed)} に変更しました。`,
          });
        },
        // 失敗は編集中のまま Error Card を出す（直して再送できる。ui-screens §4「更新系エラー」）
        onError: (error) => onNotify({ kind: "error", error }),
      },
    );
  };

  const busy = deletePasskey.isPending || renamePasskey.isPending;

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
          icon={<KeyRound />}
          primary={addButton}
          title="パスキーはまだありません"
        />
      ) : (
        <>
          {passkeys.data.map((passkey) => (
            <PasskeyRow
              busy={busy}
              editing={editingId === passkey.id}
              isLast={passkeys.data.length === 1}
              key={passkey.id}
              onCancelEdit={() => {
                renamePasskey.reset();
                setEditingId(null);
              }}
              onDelete={() => {
                resetMutations();
                setEditingId(null);
                setTarget(passkey);
              }}
              onEdit={() => {
                resetMutations();
                setEditingId(passkey.id);
              }}
              onRename={(name) => handleRename(passkey, name)}
              passkey={passkey}
              saving={renamePasskey.isPending && editingId === passkey.id}
            />
          ))}
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
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function PasskeyRow({
  passkey,
  isLast,
  busy,
  editing,
  saving,
  onEdit,
  onCancelEdit,
  onRename,
  onDelete,
}: PasskeyRowProps) {
  const name = passkeyName(passkey);
  // 同名の「削除」が並ぶので名前で区別する。Disabled の理由も読み上げに残す
  const label = isLast
    ? `${name} のパスキーを削除（最後の 1 つは不可）`
    : `${name} のパスキーを削除`;

  if (editing) {
    // 行ごとに mount し直すことで下書き・エラーを毎回リセットする
    return (
      <PasskeyNameEditor
        initialName={name}
        onCancel={onCancelEdit}
        onSave={onRename}
        saving={saving}
      />
    );
  }

  return (
    <div className="flex w-full items-center gap-2">
      <KeyRound aria-hidden="true" className="size-3.5 shrink-0 text-ink" />
      <span className="shrink-0 text-body-sm text-ink">{name}</span>
      <IconButton
        aria-label={`${name} の名前を変更`}
        disabled={busy}
        icon={<Pencil />}
        onClick={onEdit}
        size="sm"
        variant="subtle"
      />
      <span className="min-w-0 flex-1 truncate text-caption text-muted">
        {formatPasskeyMeta(passkey)}
      </span>
      <Button
        aria-label={label}
        disabled={isLast || busy}
        leadingIcon={<Trash2 />}
        onClick={onDelete}
        size="sm"
        variant="outline"
      >
        削除
      </Button>
    </div>
  );
}

interface PasskeyNameEditorProps {
  initialName: string;
  saving: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** 行のインライン編集。Enter で保存、Escape でキャンセル。1〜32 文字はサーバーと同じ zod で弾く */
function PasskeyNameEditor({
  initialName,
  saving,
  onSave,
  onCancel,
}: PasskeyNameEditorProps) {
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // 鉛筆を押した直後に入力できるようフォーカスを移す（autoFocus は a11y lint で弾かれる）
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = passkeyNameSchema.safeParse(draft);
    if (!parsed.success) {
      setError(PASSKEY_NAME_ERROR);
      return;
    }
    onSave(parsed.data);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <form className="flex w-full items-start gap-2" onSubmit={handleSubmit}>
      {/* Input（h-control-md）の高さで揃えるので、行のアイコンだけ余白を足さない */}
      <span className="flex h-control-md shrink-0 items-center">
        <KeyRound aria-hidden="true" className="size-3.5 text-ink" />
      </span>
      <Input
        aria-label="パスキーの名前"
        disabled={saving}
        error={error}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(undefined);
        }}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        value={draft}
      />
      <Button loading={saving} type="submit" variant="solid">
        保存
      </Button>
      <Button disabled={saving} onClick={onCancel} variant="subtle">
        キャンセル
      </Button>
    </form>
  );
}
