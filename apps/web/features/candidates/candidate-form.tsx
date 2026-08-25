"use client";

import { Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TldMultiSelect } from "./tld-select";
import { DEFAULT_TLDS, isAllTlds } from "./tlds";

/**
 * Figma: S-20 `81:741` / S-21 `81:921`
 * ui-screens S-20 の入力パネル。ニックネーム（必須）・用途キーワード・
 * 希望 TLD（複数選択、既定: 全対応 TLD）と「候補を考える」。
 * 生成中はボタンを「考え中…」で Disabled にする（ui-screens §4）。
 */

export interface CandidateFormValues {
  nickname: string;
  purpose?: string;
  tlds?: string[];
}

export interface CandidateFormProps {
  busy: boolean;
  onSubmit: (values: CandidateFormValues) => void;
}

const NICKNAME_REQUIRED = "ニックネームまたはアプリ名を入力してください";
const TLD_REQUIRED = "希望 TLD を 1 つ以上選んでください";

export function CandidateForm({ busy, onSubmit }: CandidateFormProps) {
  const [nickname, setNickname] = useState("");
  const [purpose, setPurpose] = useState("");
  const [tlds, setTlds] = useState<readonly string[]>(DEFAULT_TLDS);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tldError, setTldError] = useState<string | undefined>(undefined);

  const handleTldChange = (next: string[]) => {
    setTlds(next);
    if (next.length > 0) {
      setTldError(undefined);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = nickname.trim();
    setError(trimmed === "" ? NICKNAME_REQUIRED : undefined);
    setTldError(tlds.length === 0 ? TLD_REQUIRED : undefined);
    if (trimmed === "" || tlds.length === 0) {
      return;
    }
    const purposeValue = purpose.trim();
    onSubmit({
      nickname: trimmed,
      ...(purposeValue === "" ? {} : { purpose: purposeValue }),
      // 既定は全対応 TLD（ui-screens S-20）。API には「絞り込んだとき」だけ渡す
      ...(isAllTlds(tlds) ? {} : { tlds: [...tlds] }),
    });
  };

  return (
    <form
      className="flex w-full flex-col gap-3 border-2 border-line border-solid bg-panel px-4 py-3"
      // 必須の表示は `required` に任せつつ、文言は ui-screens §4 に合わせて自前で出す
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Input
            autoComplete="off"
            label="ニックネームまたはアプリ名 *"
            onChange={(event) => setNickname(event.target.value)}
            placeholder="たくたく / dopamin"
            required
            surface="panel"
            value={nickname}
            {...(error === undefined ? {} : { error })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Input
            autoComplete="off"
            label="用途・キーワード"
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="学生エンジニア / ポートフォリオ"
            surface="panel"
            value={purpose}
          />
        </div>
        <Button
          disabled={busy}
          leadingIcon={<Sparkles />}
          type="submit"
          variant="primary"
        >
          {busy ? "考え中…" : "候補を考える"}
        </Button>
      </div>
      <TldMultiSelect
        label="希望 TLD"
        onChange={handleTldChange}
        value={tlds}
        {...(tldError === undefined ? {} : { error: tldError })}
      />
    </form>
  );
}
