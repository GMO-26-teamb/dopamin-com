"use client";

import type { RegistrantProfile } from "@dopamin/shared";
import { ALLOWED_CONTACT_NAMES, hostNameSchema } from "@dopamin/shared";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";

/**
 * ネームサーバーと登録者コンタクトの入力欄・検証（FR-06 / FR-09）。
 *
 * D-02 情報修正（`ns-edit-dialog.tsx`）と S-25 登録ダイアログ
 * （`features/candidates/register-dialog.tsx`）で同じ規則・同じ見た目を使うため、
 * 検証関数と入力欄をここ 1 か所に置く。値域はレジストリが許可するダミー値だけで、
 * **送る前に弾く**（レジストリの 2xxx エラーで気付くのでは遅い）。
 */

export const MIN_NAMESERVERS = 2;
export const MAX_NAMESERVERS = 13;

/** レジストリが許可するダミー PII のメールドメイン（`RegistrantProfile`）。 */
export const ALLOWED_EMAIL_DOMAINS = [
  "example.com",
  "example.net",
  "example.org",
];

/** 入力行。並べ替え・削除しても React のキーが崩れないよう id を持たせる。 */
export interface NsRow {
  id: string;
  value: string;
}

let rowSequence = 0;

export function newRow(value: string): NsRow {
  rowSequence += 1;
  return { id: `ns-${rowSequence}`, value };
}

/** 空行を落としたネームサーバー。 */
export function compact(rows: readonly string[]): string[] {
  return rows.map((row) => row.trim()).filter((row) => row.length > 0);
}

/** ネームサーバーの検証（0 件 = 未設定 / 全解除、または 2〜13 件）。 */
export function validateNameservers(rows: readonly string[]): string | null {
  const values = compact(rows);
  if (values.length === 0) {
    return null;
  }
  if (values.length < MIN_NAMESERVERS) {
    return `ネームサーバーは 0 件（全解除）または ${MIN_NAMESERVERS}〜${MAX_NAMESERVERS} 件で指定してください`;
  }
  if (values.length > MAX_NAMESERVERS) {
    return `ネームサーバーは ${MAX_NAMESERVERS} 件までです`;
  }
  const invalid = values.find(
    (value) => !hostNameSchema.safeParse(value).success,
  );
  if (invalid !== undefined) {
    return `ホスト名の形式が不正です: ${invalid}`;
  }
  if (new Set(values.map((v) => v.toLowerCase())).size !== values.length) {
    return "同じネームサーバーが重複しています";
  }
  return null;
}

/** レジストリが受け付ける架空ダミー氏名か（`ALLOWED_CONTACT_NAMES` が値域の正）。 */
export function isAllowedContactName(
  value: string,
): value is RegistrantProfile["name"] {
  return (ALLOWED_CONTACT_NAMES as readonly string[]).includes(value);
}

/**
 * 登録者の氏名の検証（ダミー PII のみ・docs/registry/spec-notes.md）。
 *
 * 値域は `registrantProfileSchema` と同じ 8 種。ここで弾かないと API が
 * `VALIDATION_ERROR` を返すだけになり、理由が画面に出ない。
 */
export function validateRegistrantName(name: string): string | null {
  const value = name.trim();
  if (value.length === 0) {
    return "登録者の氏名は必須です";
  }
  if (!isAllowedContactName(value)) {
    return `氏名に使えるのは ${ALLOWED_CONTACT_NAMES.join(" / ")} のみです（ダミー PII）`;
  }
  return null;
}

/** 登録者のメールアドレスの検証（配送不能な予約ドメインのみ）。 */
export function validateRegistrantEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) {
    return "登録者のメールアドレスは必須です";
  }
  const domain = normalized.split("@")[1];
  if (domain === undefined || !ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    return `メールアドレスは ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" / ")} のみ使えます（ダミー PII）`;
  }
  return null;
}

export interface NameserverRowsProps {
  rows: readonly NsRow[];
  onRowsChange: (rows: NsRow[]) => void;
  /** 送信を試みるまでは null にして、入力中は赤くしない。 */
  error: string | null;
}

/** ネームサーバーの入力行 + 追加ボタン（2〜13 件）。 */
export function NameserverRows({
  rows,
  onRowsChange,
  error,
}: NameserverRowsProps) {
  return (
    <>
      {rows.map((row, index) => (
        <div className="flex w-full items-end gap-2" key={row.id}>
          <div className="min-w-0 flex-1">
            <Input
              autoComplete="off"
              label={`ネームサーバー ${index + 1}`}
              monospace
              onChange={(event) =>
                onRowsChange(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, value: event.target.value }
                      : item,
                  ),
                )
              }
              // 行ごとに番号を合わせる（全行が ns1 だと 2 行目の見本にならない）
              placeholder={`ns${index + 1}.example.com`}
              surface="panel"
              value={row.value}
            />
          </div>
          <IconButton
            aria-label={`ネームサーバー ${index + 1} を削除`}
            disabled={rows.length <= 1}
            icon={<X />}
            onClick={() =>
              onRowsChange(rows.filter((item) => item.id !== row.id))
            }
            size="sm"
            variant="subtle"
          />
        </div>
      ))}
      <div className="flex w-full items-center justify-between gap-2">
        <Button
          disabled={rows.length >= MAX_NAMESERVERS}
          leadingIcon={<Plus />}
          onClick={() => onRowsChange([...rows, newRow("")])}
          size="sm"
          variant="subtle"
        >
          ネームサーバーを追加
        </Button>
        {error === null ? null : (
          <p className="text-caption text-warn" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

export interface RegistrantFieldsProps {
  name: string;
  email: string;
  onNameChange: (name: string) => void;
  onEmailChange: (email: string) => void;
  /** 送信を試みるまでは null にする。 */
  nameError: string | null;
  emailError: string | null;
}

/** 登録者（Registrant）の氏名・メール。住所と国は既定値で補う（入力欄を持たない）。 */
export function RegistrantFields({
  name,
  email,
  onNameChange,
  onEmailChange,
  nameError,
  emailError,
}: RegistrantFieldsProps) {
  return (
    <>
      <Input
        autoComplete="off"
        helper={`使えるのは ${ALLOWED_CONTACT_NAMES.join(" / ")} のみです`}
        label="登録者 氏名"
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Taro Test"
        surface="panel"
        value={name}
        {...(nameError === null ? {} : { error: nameError })}
      />
      <Input
        autoComplete="off"
        helper={`許可されるのは ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" / ")} のみです`}
        label="登録者 メールアドレス"
        onChange={(event) => onEmailChange(event.target.value)}
        placeholder="taro.test@example.com"
        surface="panel"
        type="email"
        value={email}
        {...(emailError === null ? {} : { error: emailError })}
      />
    </>
  );
}
