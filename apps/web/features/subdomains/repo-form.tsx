"use client";

import { WandSparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * S-40 / S-41 / S-42 のリポジトリ入力。
 * 「リポジトリを解析」でリポ URL から、「概要から提案」でテキストから提案する（AC-13-2）。
 */

const REPO_PLACEHOLDER = "https://github.com/<owner>/<repo>（公開リポジトリ）";
const DESCRIPTION_PLACEHOLDER =
  "例: Next.js のポートフォリオ + Hono の API + ドキュメントサイト";

export interface RepoFormProps {
  /** 保存済み設計の `repoUrl` を読み込み後に流し込む */
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  /** 概要入力欄を開いているか（S-42 では取得失敗と同時に開く） */
  descriptionOpen: boolean;
  onDescriptionOpenChange: (open: boolean) => void;
  analyzing: boolean;
  onPropose: (input: { repoUrl: string }) => void;
}

export function RepoForm({
  repoUrl,
  onRepoUrlChange,
  descriptionOpen,
  onDescriptionOpenChange,
  analyzing,
  onPropose,
}: RepoFormProps) {
  const trimmed = repoUrl.trim();

  return (
    <div className="flex w-full items-center gap-2">
      <Input
        aria-label="リポジトリ URL"
        autoComplete="off"
        disabled={analyzing}
        monospace
        onChange={(event) => onRepoUrlChange(event.target.value)}
        placeholder={REPO_PLACEHOLDER}
        value={repoUrl}
      />
      <Button
        className="shrink-0"
        disabled={analyzing || trimmed === ""}
        leadingIcon={<WandSparkles />}
        onClick={() => onPropose({ repoUrl: trimmed })}
        variant="outline"
      >
        {analyzing ? "解析中…" : "リポジトリを解析"}
      </Button>
      <Button
        aria-expanded={descriptionOpen}
        className="shrink-0"
        disabled={analyzing}
        onClick={() => onDescriptionOpenChange(!descriptionOpen)}
        variant="subtle"
      >
        概要を書いて提案
      </Button>
    </div>
  );
}

export interface DescriptionFormProps {
  analyzing: boolean;
  onPropose: (input: { description: string }) => void;
}

/** S-42 下段。リポジトリを取得できないときの代替入力（AC-13-2）。 */
export function DescriptionForm({
  analyzing,
  onPropose,
}: DescriptionFormProps) {
  const [description, setDescription] = useState("");
  const trimmed = description.trim();

  return (
    <div className="flex w-full items-end gap-2">
      <Input
        autoComplete="off"
        disabled={analyzing}
        label="プロジェクト概要"
        onChange={(event) => setDescription(event.target.value)}
        placeholder={DESCRIPTION_PLACEHOLDER}
        value={description}
      />
      <Button
        className="shrink-0"
        disabled={analyzing || trimmed === ""}
        leadingIcon={<WandSparkles />}
        onClick={() => onPropose({ description: trimmed })}
        variant="outline"
      >
        {analyzing ? "解析中…" : "概要から提案"}
      </Button>
    </div>
  );
}
