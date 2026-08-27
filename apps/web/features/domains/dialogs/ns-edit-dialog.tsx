"use client";

import type { ClientStatus } from "@dopamin/shared";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import type { DomainUpdateInput } from "@/lib/api/services";
import type { DomainDetail } from "@/lib/api/types";
import { isTransferLocked } from "../detail/derive";
import {
  compact,
  isAllowedContactName,
  MAX_NAMESERVERS,
  MIN_NAMESERVERS,
  NameserverRows,
  type NsRow,
  newRow,
  RegistrantFields,
  validateNameservers,
  validateRegistrantEmail,
  validateRegistrantName,
} from "./ns-contact-fields";

/**
 * Figma: D-02 `83:3628`（Dialog / Form）
 *
 * ネームサーバー 2〜13 件（追加行）+ コンタクト（登録者）+ 移管ロック
 * （ui-screens D-02 / FR-09）。入力欄と検証は S-25 登録ダイアログと共有する
 * （`ns-contact-fields.tsx`）。
 *
 * **送るのは変更した項目だけ。** 未変更の NS やコンタクトまで載せると、
 * ロック解除だけの要求が API の `unlockOnly` 経路（`clientUpdateProhibited` 中でも
 * 解除を通す）から外れる。何も変わっていないときだけ NS を載せて
 * 「変更内容を 1 つ以上」（`domainUpdateRequestSchema`）を満たす。
 */

/** 移管ロックとして付け外しする Client ステータス（FR-09 / §11.3）。 */
const TRANSFER_LOCK: ClientStatus = "clientTransferProhibited";

export interface NsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  busy: boolean;
  onSubmit: (input: DomainUpdateInput) => void;
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
      <NameserverRows
        error={submitted ? nsError : null}
        onRowsChange={setRows}
        rows={rows}
      />

      <Divider weight="thin" />
      <p className="w-full text-overline text-muted">コンタクト（ダミーPII）</p>
      <RegistrantFields
        email={registrantEmail}
        emailError={submitted ? emailError : null}
        name={registrantName}
        nameError={submitted ? nameError : null}
        onEmailChange={setRegistrantEmail}
        onNameChange={setRegistrantName}
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
