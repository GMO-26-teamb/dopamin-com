"use client";

import { hostNameSchema } from "@dopamin/shared";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { DomainContactsInput, DomainDetail } from "@/lib/api/types";
import { isTransferLocked } from "../detail/derive";

/**
 * Figma: D-02 `83:3628`（Dialog / Form）
 *
 * ネームサーバー 2〜13 件（追加行）+ コンタクト（登録者）セクション（ui-screens D-02 / FR-09）。
 * 移管ロックのトグルは requirements FR-09 の【要確認】（`add.statuses` が反映されない実測）が
 * 解決するまで無効化し、理由を出す。
 */
export const MIN_NAMESERVERS = 2;
export const MAX_NAMESERVERS = 13;

/** レジストリが許可するダミー PII のメールドメイン（`RegistrantProfile`）。 */
const ALLOWED_EMAIL_DOMAINS = ["example.com", "example.net", "example.org"];

export interface NsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  busy: boolean;
  onSubmit: (input: {
    nameservers: string[];
    contacts?: DomainContactsInput;
  }) => void;
}

/** 入力行。並べ替え・削除しても React のキーが崩れないよう id を持たせる。 */
interface NsRow {
  id: string;
  value: string;
}

let rowSequence = 0;

function newRow(value: string): NsRow {
  rowSequence += 1;
  return { id: `ns-${rowSequence}`, value };
}

/** 空行を落としたネームサーバー。 */
function compact(rows: readonly string[]): string[] {
  return rows.map((row) => row.trim()).filter((row) => row.length > 0);
}

/** ネームサーバーの検証（0 件 = 全解除、または 2〜13 件）。 */
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

/** 登録者コンタクトの検証（ダミー PII のみ・docs/registry/spec-notes.md）。 */
export function validateRegistrant(name: string, email: string): string | null {
  if (name.trim().length === 0) {
    return "登録者の氏名は必須です";
  }
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

export function NsEditDialog({
  open,
  onOpenChange,
  domain,
  busy,
  onSubmit,
}: NsEditDialogProps) {
  const [rows, setRows] = useState<NsRow[]>([]);
  const [registrantName, setRegistrantName] = useState("");
  const [registrantEmail, setRegistrantEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // 開くたびに現在値へ戻す
  useEffect(() => {
    if (!open) {
      return;
    }
    setRows(
      (domain.nameservers.length === 0 ? ["", ""] : domain.nameservers).map(
        newRow,
      ),
    );
    setRegistrantName(domain.registrant.name);
    setRegistrantEmail(domain.registrant.email);
    setSubmitted(false);
  }, [open, domain]);

  const values = rows.map((row) => row.value);
  const nsError = validateNameservers(values);
  const contactError = validateRegistrant(registrantName, registrantEmail);
  const contactChanged =
    registrantName.trim() !== domain.registrant.name ||
    registrantEmail.trim() !== domain.registrant.email ||
    !domain.registrant.migrated;

  function updateRow(id: string, value: string) {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, value } : row)),
    );
  }

  function submit() {
    setSubmitted(true);
    if (nsError !== null || contactError !== null) {
      return;
    }
    onSubmit({
      nameservers: compact(values),
      ...(contactChanged
        ? {
            contacts: {
              registrant: {
                name: registrantName.trim(),
                email: registrantEmail.trim(),
              },
            },
          }
        : {}),
    });
  }

  return (
    <FormDialog
      busy={busy}
      onOpenChange={onOpenChange}
      onPrimary={submit}
      open={open}
      primaryLabel={busy ? "変更中…" : "変更する"}
      subtitle={`${domain.name}・${MIN_NAMESERVERS}〜${MAX_NAMESERVERS} 件。ホストオブジェクトは自動作成します`}
      title="情報修正（NS・コンタクト）"
    >
      {rows.map((row, index) => (
        <div className="flex w-full items-end gap-2" key={row.id}>
          <div className="min-w-0 flex-1">
            <Input
              autoComplete="off"
              label={`ネームサーバー ${index + 1}`}
              monospace
              onChange={(event) => updateRow(row.id, event.target.value)}
              placeholder="ns1.example.com"
              surface="panel"
              value={row.value}
            />
          </div>
          <IconButton
            aria-label={`ネームサーバー ${index + 1} を削除`}
            disabled={rows.length <= 1}
            icon={<X />}
            onClick={() =>
              setRows((prev) => prev.filter((item) => item.id !== row.id))
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
          onClick={() => setRows((prev) => [...prev, newRow("")])}
          size="sm"
          variant="subtle"
        >
          ネームサーバーを追加
        </Button>
        {submitted && nsError !== null ? (
          <p className="text-caption text-warn" role="alert">
            {nsError}
          </p>
        ) : null}
      </div>

      <Divider weight="thin" />
      <p className="w-full text-overline text-muted">コンタクト（ダミーPII）</p>
      <Input
        autoComplete="off"
        label="登録者 氏名"
        onChange={(event) => setRegistrantName(event.target.value)}
        placeholder="Taro Test"
        surface="panel"
        value={registrantName}
      />
      <Input
        autoComplete="off"
        helper={`許可されるのは ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" / ")} のみです`}
        label="登録者 メールアドレス"
        onChange={(event) => setRegistrantEmail(event.target.value)}
        placeholder="taro.test@example.com"
        surface="panel"
        type="email"
        value={registrantEmail}
        {...(submitted && contactError !== null ? { error: contactError } : {})}
      />
      <p className="w-full text-caption-sm text-muted">
        技術担当（Technical）は任意です。現時点では登録者のみを扱います（FR-09）。
      </p>

      <Divider weight="thin" />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-body-sm text-muted">移管ロック</span>
        <div className="flex items-center gap-2">
          <Badge tone="neutral" variant="solid">
            {isTransferLocked(domain.statuses) ? "ON" : "OFF"}
          </Badge>
          <Button disabled size="sm" variant="subtle">
            {isTransferLocked(domain.statuses) ? "解除する" : "ロックする"}
          </Button>
        </div>
      </div>
      <p className="w-full text-caption-sm text-muted">
        レジストリ側で反映されないことが実測で判明しているため、いまは変更できません（FR-09
        の要確認）。
      </p>
    </FormDialog>
  );
}
