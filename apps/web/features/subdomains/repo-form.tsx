"use client";

import { WandSparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * S-40 / S-41 / S-42 のリポジトリ入力。
 * 「リポジトリを解析」でリポ URL から、「概要から提案」でテキストから提案する（AC-13-2）。
 *
 * Primary は 1 画面 1 つなので、どのボタンを Primary にするかは呼び出し元が決める:
 * 設計がまだ無い間は提案の導線（S-40 は「リポジトリを解析」/ S-42 は「概要から提案」）、
 * 設計があるときは反映セクションの「DNS に反映」が Primary。
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
  /** 画面に他の Primary が無いとき（S-40）だけ「リポジトリを解析」を Primary にする */
  analyzePrimary?: boolean;
  /** 直前のリポジトリ取得が失敗している（S-42）。概要入力への導線を subtle から上げる */
  recovering?: boolean;
  onPropose: (input: { repoUrl: string }) => void;
}

export function RepoForm({
  repoUrl,
  onRepoUrlChange,
  descriptionOpen,
  onDescriptionOpenChange,
  analyzing,
  analyzePrimary = false,
  recovering = false,
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
        variant={analyzePrimary ? "primary" : "outline"}
      >
        {analyzing ? "解析中…" : "リポジトリを解析"}
      </Button>
      <Button
        aria-expanded={descriptionOpen}
        className="shrink-0"
        disabled={analyzing}
        onClick={() => onDescriptionOpenChange(!descriptionOpen)}
        variant={recovering ? "outline" : "subtle"}
      >
        概要を書いて提案
      </Button>
    </div>
  );
}

export interface DescriptionFormProps {
  analyzing: boolean;
  /** 設計がまだ無い間（S-40 / S-42）は、ここが画面唯一の Primary になる */
  proposePrimary?: boolean;
  onPropose: (input: { description: string }) => void;
}

/** S-42 下段。リポジトリを取得できないときの代替入力（AC-13-2）。 */
export function DescriptionForm({
  analyzing,
  proposePrimary = false,
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
        variant={proposePrimary ? "primary" : "outline"}
      >
        {analyzing ? "解析中…" : "概要から提案"}
      </Button>
    </div>
  );
}
