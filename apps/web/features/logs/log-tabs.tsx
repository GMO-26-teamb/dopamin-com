"use client";

import { ScrollText, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiLogs, useOperationLogs } from "@/lib/api/hooks";
import { AiLogList } from "./ai-log-list";
import { OperationLogList } from "./operation-log-list";

/**
 * Figma: S-60 `85:6086` / S-61 `85:6309`
 * ログ画面のタブ（操作ログ / AI ログ）。選択中のタブは URL の `?tab=` と同期し、
 * P-01（AI ログパネル）の「すべてのログを見る」→ `/logs?tab=ai` がそのまま S-61 に着地する。
 */

const OPERATIONS_TAB = "operations";
const AI_TAB = "ai";

type LogTab = typeof OPERATIONS_TAB | typeof AI_TAB;

/** 件数が取れるまでは数字を出さない（ダッシュで場所だけ確保する）。 */
function countLabel(count: number | undefined): string {
  return count === undefined ? "—" : String(count);
}

export function LogTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const operations = useOperationLogs();
  const ai = useAiLogs();

  const tab: LogTab =
    searchParams.get("tab") === AI_TAB ? AI_TAB : OPERATIONS_TAB;

  function selectTab(next: string): void {
    // `?mock=` などほかのクエリは残したまま `tab` だけ差し替える
    const params = new URLSearchParams(searchParams.toString());
    if (next === AI_TAB) {
      params.set("tab", AI_TAB);
    } else {
      params.delete("tab");
    }
    const query = params.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, {
      scroll: false,
    });
  }

  return (
    <>
      <PageHeader
        meta={`操作ログ ${countLabel(operations.data?.length)} · AI ログ ${countLabel(ai.data?.length)}`}
        title="ログ"
      />
      <Tabs onValueChange={selectTab} value={tab}>
        <TabsList>
          <TabsTrigger
            count={operations.data?.length}
            icon={<ScrollText />}
            value={OPERATIONS_TAB}
          >
            操作ログ
          </TabsTrigger>
          <TabsTrigger
            count={ai.data?.length}
            icon={<Sparkles />}
            value={AI_TAB}
          >
            AI ログ
          </TabsTrigger>
        </TabsList>
        <TabsContent value={OPERATIONS_TAB}>
          <OperationLogList />
        </TabsContent>
        <TabsContent value={AI_TAB}>
          <AiLogList />
        </TabsContent>
      </Tabs>
    </>
  );
}
