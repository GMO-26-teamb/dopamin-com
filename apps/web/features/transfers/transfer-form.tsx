"use client";

/**
 * Figma: S-50 `85:5523` の「移管 IN — 他社から持ち込む」カード（FR-12 / AC-12-1）。
 *
 * 入力はクライアント側でも `@dopamin/shared` の `transferCreateRequestSchema` で
 * 検証してからレジストリに送る（AC-03-3 と同じ方針）。レジストリの拒否（AC-12-2）は
 * 呼び出し側から `error` を受け取り、カード下に Error Card として出す（S-52）。
 */

import { transferCreateRequestSchema } from "@dopamin/shared";
import { ArrowLeftRight } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { Input } from "@/components/ui/input";
import type { ApiClientError } from "@/lib/api/errors";

const HELPER =
  "相手レジストラで発行した AuthCode が必要です。申請後は相手の承認（または 20 分後の自動承認）で取り込まれます";

interface FieldErrors {
  name?: string;
  authCode?: string;
}

/** 送信前のクライアント検証。空欄はフィールド固有の文言にする。 */
export function validateTransferInput(
  name: string,
  authCode: string,
):
  | { ok: true; value: { name: string; authCode: string } }
  | {
      ok: false;
      errors: FieldErrors;
    } {
  const errors: FieldErrors = {};
  const trimmedName = name.trim();
  const trimmedCode = authCode.trim();

  if (trimmedName === "") {
    errors.name = "ドメイン名を入力してください";
  }
  if (trimmedCode === "") {
    errors.authCode = "AuthCode を入力してください";
  }
  if (errors.name !== undefined || errors.authCode !== undefined) {
    return { ok: false, errors };
  }

  const parsed = transferCreateRequestSchema.safeParse({
    name: trimmedName,
    authCode: trimmedCode,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "name") {
        errors.name = "ドメイン名の形式が正しくありません（例: example.com）";
      }
      if (field === "authCode") {
        errors.authCode = "AuthCode は 64 文字以内で入力してください";
      }
    }
    return { ok: false, errors };
  }

  return { ok: true, value: parsed.data };
}

export interface TransferFormProps {
  /** ダッシュボード / 詳細から `/transfers?domain=<name>` で渡ってくる初期値 */
  defaultDomain?: string;
  /** S-53（更新エラー）のとき申請も止める */
  disabled?: boolean;
  submitting?: boolean;
  /** 直前の申請がレジストリに拒否されたときのエラー（S-52） */
  error?: ApiClientError | null;
  onSubmit: (input: { name: string; authCode: string }) => void;
}

export function TransferForm({
  defaultDomain = "",
  disabled = false,
  submitting = false,
  error = null,
  onSubmit,
}: TransferFormProps) {
  const [name, setName] = useState(defaultDomain);
  const [authCode, setAuthCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // `?domain=` は遷移後に確定する（Suspense 解決後の初回レンダーで空のことがある）
  useEffect(() => {
    if (defaultDomain !== "") {
      setName(defaultDomain);
    }
  }, [defaultDomain]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateTransferInput(name, authCode);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    onSubmit(result.value);
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <Card kicker="移管 IN — 他社から持ち込む">
        <form className="flex w-full flex-col gap-2" onSubmit={handleSubmit}>
          <div className="flex w-full items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                aria-label="ドメイン名"
                autoComplete="off"
                disabled={disabled || submitting}
                error={fieldErrors.name}
                name="domain"
                onChange={(event) => setName(event.target.value)}
                placeholder="ドメイン名"
                surface="panel"
                value={name}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Input
                aria-label="AuthCode"
                autoComplete="off"
                disabled={disabled || submitting}
                error={fieldErrors.authCode}
                name="authCode"
                onChange={(event) => setAuthCode(event.target.value)}
                placeholder="AuthCode"
                surface="panel"
                value={authCode}
              />
            </div>
            <Button
              className="shrink-0"
              disabled={disabled || submitting}
              leadingIcon={<ArrowLeftRight />}
              loading={submitting}
              type="submit"
              variant="primary"
            >
              {submitting ? "申請中…" : "申請"}
            </Button>
          </div>
          <p className="text-caption text-muted">{HELPER}</p>
        </form>
      </Card>
      {error ? <ErrorCard error={error} showLogsLink /> : null}
    </div>
  );
}
