"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, type SelectOption } from "@/components/ui/select";
import { useUpdateAiSettings } from "@/lib/api/hooks";
import type { AiSettings } from "@/lib/api/types";
import type { NotifySettings } from "./notice";

/**
 * Figma: S-70 `85:6709`（Card kicker「AI 設定」+ Select ×2）
 * FR-17 の AI プロバイダ / モデル切替。選択した時点で保存し、成功は Banner Ok（S-70b）。
 *
 * 選択肢は `GET /auth/me` の `ai.providers` から取る（ui-screens §7-2 の仮置き）。
 * 【要確認】専用の取得 API（`GET /settings/ai`）に変わったら hooks 側だけ差し替える。
 */

type Provider = AiSettings["provider"];

const PROVIDER_LABEL: Record<Provider, string> = {
  google: "Google",
  anthropic: "Anthropic",
  xai: "Grok",
};

interface Draft {
  provider: Provider;
  model: string;
}

export interface AiSettingsSectionProps {
  ai: AiSettings;
  onNotify: NotifySettings;
  className?: string;
}

export function AiSettingsSection({
  ai,
  onNotify,
  className,
}: AiSettingsSectionProps) {
  const update = useUpdateAiSettings();
  const [saved, setSaved] = useState<Draft>({
    provider: ai.provider,
    model: ai.model,
  });
  const [draft, setDraft] = useState<Draft>(saved);

  // サーバー側の値が変わったら描画中に追従する（React 公式の「props で state を調整する」形）
  if (saved.provider !== ai.provider || saved.model !== ai.model) {
    const next: Draft = { provider: ai.provider, model: ai.model };
    setSaved(next);
    setDraft(next);
  }

  const save = (next: Draft) => {
    setDraft(next);
    onNotify(null);
    update.mutate(next, {
      // 何を選んだかは直上の Select が見せているので、帯では繰り返さない
      onSuccess: () => {
        onNotify({
          kind: "banner",
          tone: "ok",
          title: "AI 設定を保存しました",
        });
      },
      // 失敗したら表示を保存済みの値に戻す（ローカルだけ進んで見えないように）
      onError: (error) => {
        setDraft({ provider: ai.provider, model: ai.model });
        onNotify({ kind: "error", error });
      },
    });
  };

  const providerOptions: SelectOption[] = ai.providers.map((provider) => ({
    value: provider.id,
    label: PROVIDER_LABEL[provider.id],
  }));
  const models = ai.providers.find(({ id }) => id === draft.provider)?.models;
  const modelOptions: SelectOption[] = (
    models?.includes(draft.model) ? models : [draft.model, ...(models ?? [])]
  ).map((model) => ({ value: model, label: model }));

  return (
    <Card className={className} kicker="AI 設定">
      <div className="flex w-full flex-col items-start gap-2 sm:flex-row">
        <Select
          disabled={update.isPending}
          label="プロバイダ"
          onValueChange={(value) => {
            const next = ai.providers.find(({ id }) => id === value);
            if (next === undefined || next.id === draft.provider) return;
            save({ provider: next.id, model: next.models[0] ?? draft.model });
          }}
          options={providerOptions}
          surface="panel"
          value={draft.provider}
        />
        <Select
          disabled={update.isPending}
          label="モデル"
          onValueChange={(model) => {
            if (model === draft.model) return;
            save({ provider: draft.provider, model });
          }}
          options={modelOptions}
          surface="panel"
          value={draft.model}
        />
      </div>
    </Card>
  );
}
