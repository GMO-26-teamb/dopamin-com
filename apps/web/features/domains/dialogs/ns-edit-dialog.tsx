"use client";

import {
  ALLOWED_CONTACT_NAMES,
  type ClientStatus,
  hostNameSchema,
  type RegistrantProfile,
} from "@dopamin/shared";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { DomainUpdateInput } from "@/lib/api/services";
import type { DomainDetail } from "@/lib/api/types";
import { isTransferLocked } from "../detail/derive";

/**
 * Figma: D-02 `83:3628`（Dialog / Form）
 *
 * ネームサーバー 2〜13 件（追加行）+ コンタクト（登録者）+ 移管ロック
 * （ui-screens D-02 / FR-09）。
 *
 * **送るのは変更した項目だけ。** 未変更の NS やコンタクトまで載せると、
 * ロック解除だけの要求が API の `unlockOnly` 経路（`clientUpdateProhibited` 中でも
 * 解除を通す）から外れる。何も変わっていないときだけ NS を載せて
 * 「変更内容を 1 つ以上」（`domainUpdateRequestSchema`）を満たす。
 */
export const MIN_NAMESERVERS = 2;
export const MAX_NAMESERVERS = 13;

/** レジストリが許可するダミー PII のメールドメイン（`RegistrantProfile`）。 */
const ALLOWED_EMAIL_DOMAINS = ["example.com", "example.net", "example.org"];

/** 移管ロックとして付け外しする Client ステータス（FR-09 / §11.3）。 */
const TRANSFER_LOCK: ClientStatus = "clientTransferProhibited";

export interface NsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  busy: boolean;
  onSubmit: (input: DomainUpdateInput) => void;
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

/** レジストリが受け付ける架空ダミー氏名か（`ALLOWED_CONTACT_NAMES` が値域の正）。 */
function isAllowedContactName(
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

/**
 * 移管ロックのトグルを押せない理由（AC-09-2 / §11.3）。押せるなら null。
 *
 * Server ステータスはレジストリ側の意思なのでクライアントからは動かせない
 * （`serverUpdateProhibited` は更新そのものが不可、`serverTransferProhibited` は
 * client 側を外してもロックが残る）。
 */
export function lockToggleBlockedBy(
  statuses: readonly string[],
): string | null {
  return (
    ["serverUpdateProhibited", "serverTransferProhibited"].find((status) =>
      statuses.includes(status),
    ) ?? null
  );
}

/** NS の集合が同じか（大文字小文字・並び順の違いは変更と見なさない）。 */
function sameNameservers(a: readonly string[], b: readonly string[]): boolean {
  const normalize = (list: readonly string[]) =>
    [...new Set(list.map((value) => value.toLowerCase()))].sort();
  const left = normalize(a);
  const right = normalize(b);
  return left.length === right.length && left.every((v, i) => v === right[i]);
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
  /** トグルの操作後の値。現在値（`lockedNow`）と違えば `clientStatuses` を送る。 */
  const [lockOn, setLockOn] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // 開いた瞬間だけ現在値へ戻す。`domain` は再取得のたびに参照が変わるので
  // 依存に入れず ref 経由で読む（入力中に値が巻き戻らないように）
  const domainRef = useRef(domain);
  domainRef.current = domain;
  useEffect(() => {
    if (!open) {
      return;
    }
    const current = domainRef.current;
    setRows(
      (current.nameservers.length === 0 ? ["", ""] : current.nameservers).map(
        newRow,
      ),
    );
    setRegistrantName(current.registrant.name);
    setRegistrantEmail(current.registrant.email);
    setLockOn(isTransferLocked(current.statuses));
    setSubmitted(false);
  }, [open]);

  const values = rows.map((row) => row.value);
  const nsError = validateNameservers(values);
  const nameError = validateRegistrantName(registrantName);
  const emailError = validateRegistrantEmail(registrantEmail);

  const lockedNow = isTransferLocked(domain.statuses);
  const lockBlockedBy = lockToggleBlockedBy(domain.statuses);
  const nameservers = compact(values);
  const nsChanged = !sameNameservers(nameservers, domain.nameservers);
  const contactChanged =
    registrantName.trim() !== domain.registrant.name ||
    registrantEmail.trim() !== domain.registrant.email ||
    !domain.registrant.migrated;
  const lockChanged = lockOn !== lockedNow;

  function updateRow(id: string, value: string) {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, value } : row)),
    );
  }

  function submit() {
    setSubmitted(true);
    if (nsError !== null || nameError !== null || emailError !== null) {
      return;
    }
    const name = registrantName.trim();
    // 検証済みだが、`RegistrantProfile["name"]` のユニオンに絞るために再度確認する
    if (!isAllowedContactName(name)) {
      return;
    }
    onSubmit({
      // 何も変わっていないときは NS を載せて「変更内容を 1 つ以上」を満たす
      ...(nsChanged || (!contactChanged && !lockChanged)
        ? { nameservers }
        : {}),
      ...(contactChanged
        ? { contacts: { registrant: { name, email: registrantEmail.trim() } } }
        : {}),
      ...(lockChanged
        ? {
            clientStatuses: lockOn
              ? { add: [TRANSFER_LOCK] }
              : { remove: [TRANSFER_LOCK] },
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
      primaryLabel={busy ? "修正中…" : "情報を修正する"}
      subtitle={`${domain.name} · ${MIN_NAMESERVERS}〜${MAX_NAMESERVERS} 件。ホストオブジェクトは自動作成します`}
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
        helper={`使えるのは ${ALLOWED_CONTACT_NAMES.join(" / ")} のみです`}
        label="登録者 氏名"
        onChange={(event) => setRegistrantName(event.target.value)}
        placeholder="Taro Test"
        surface="panel"
        value={registrantName}
        {...(submitted && nameError !== null ? { error: nameError } : {})}
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
        {...(submitted && emailError !== null ? { error: emailError } : {})}
      />
      <p className="w-full text-caption-sm text-muted">
        技術担当（Technical）は任意です。現時点では登録者のみを扱います（FR-09）。
      </p>

      <Divider weight="thin" />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-body-sm text-muted">移管ロック</span>
        <div className="flex items-center gap-2">
          <Badge tone={lockChanged ? "warn" : "neutral"} variant="solid">
            {lockOn ? "ON" : "OFF"}
          </Badge>
          <Button
            disabled={lockBlockedBy !== null}
            onClick={() => setLockOn((prev) => !prev)}
            size="sm"
            variant="subtle"
          >
            {lockOn ? "解除する" : "ロックする"}
          </Button>
        </div>
      </div>
      <p className="w-full text-caption-sm text-muted">
        {lockBlockedBy === null
          ? "ON のあいだは他社への移管を受け付けません。「情報を修正する」で反映します。"
          : `レジストリ側の ${lockBlockedBy} が付いているため変更できません（Server ステータスが優先されます・AC-09-2）。`}
      </p>
    </FormDialog>
  );
}
