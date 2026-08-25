"use client";

/**
 * 画面から使うデータ取得 hooks（fe-ui 設計 §4.5）。
 *
 * 参照系は `useQuery` をそのまま返すので、画面側は `isPending / error / data` から
 * `loading | empty | error | ready` に分岐する。更新系は成功時に関連する queryKey を
 * invalidate して一覧・詳細へ即時反映する（AC-06-1）。
 */

import type { DomainCheckRequest, PasskeySummary } from "@dopamin/shared";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { ApiClientError } from "./errors";
import { type QueryScope, useQueryScope, useServices } from "./provider";
import type { CandidateService, DomainUpdateInput } from "./services";
import type {
  AiLog,
  AiSettings,
  Candidate,
  DnsDiff,
  DomainDetail,
  DomainSummary,
  Me,
  OperationLog,
  SearchResult,
  SubdomainPlan,
  Transfer,
} from "./types";

type CandidateInput = Parameters<CandidateService["generate"]>[0];

/**
 * queryKey の一覧（fe-ui 設計 §4.5）。invalidate / setQueryData もここ経由で行う。
 *
 * 先頭には必ずスコープ（モックのシナリオ、HTTP なら `"http"`）が付く。
 * `?mock=error` に切り替わったときに既定シナリオのキャッシュを掴んだままにならないよう、
 * スコープが変わったら別の key = 別のキャッシュとして扱う。
 */
export function queryKeys(scope: QueryScope) {
  return {
    me: () => [scope, "me"] as const,
    passkeys: () => [scope, "passkeys"] as const,
    domains: () => [scope, "domains"] as const,
    domain: (name: string) => [scope, "domain", name] as const,
    candidates: (input: CandidateInput) =>
      [scope, "candidates", input] as const,
    subdomainPlan: (domain: string) =>
      [scope, "subdomain-plan", domain] as const,
    dnsDiff: (domain: string) => [scope, "dns-diff", domain] as const,
    transfers: () => [scope, "transfers"] as const,
    operationLogs: () => [scope, "logs", "operations"] as const,
    aiLogs: () => [scope, "logs", "ai"] as const,
  };
}

/** 現在のスコープを閉じ込めた queryKey 群。各 hook はこれを使う。 */
export function useQueryKeys(): ReturnType<typeof queryKeys> {
  const scope = useQueryScope();
  return useMemo(() => queryKeys(scope), [scope]);
}

type Query<T> = UseQueryResult<T, ApiClientError>;
type Mutation<TData, TVariables = void> = UseMutationResult<
  TData,
  ApiClientError,
  TVariables
>;

// ---- 設定・ユーザー（FR-01 / 16 / 17） ----

export function useMe(): Query<Me> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.me(),
    queryFn: () => services.settings.me(),
  });
}

export function useUpdateAiSettings(): Mutation<
  AiSettings,
  { provider: AiSettings["provider"]; model: string }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (input) => services.settings.updateAi(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.me() });
    },
  });
}

export function useDemoReset(): Mutation<void> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => services.settings.demoReset(),
    onSuccess: () => {
      // デモデータを作り直すので全部取り直す（FR-16）
      void queryClient.invalidateQueries();
    },
  });
}

export function usePasskeys(): Query<PasskeySummary[]> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.passkeys(),
    queryFn: () => services.auth.listPasskeys(),
  });
}

export function useAddPasskey(): Mutation<PasskeySummary> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: () => services.auth.addPasskey(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.passkeys() });
    },
  });
}

export function useDeletePasskey(): Mutation<void, string> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (id) => services.auth.deletePasskey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.passkeys() });
    },
  });
}

// ---- ドメイン（FR-02 / 03 / 06〜12） ----

export function useDomains(): Query<DomainSummary[]> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.domains(),
    queryFn: () => services.domains.list(),
  });
}

export function useSyncDomains(): Mutation<DomainSummary[]> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: () => services.domains.sync(),
    onSuccess: (domains) => {
      queryClient.setQueryData(keys.domains(), domains);
    },
  });
}

export function useDomain(name: string): Query<DomainDetail> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.domain(name),
    queryFn: () => services.domains.get(name),
    enabled: name !== "",
  });
}

export function useCheckDomains(): Mutation<
  SearchResult[],
  DomainCheckRequest
> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (input) => services.domains.check(input),
    // check は独自性スコア（FR-05）も返す = AI 呼び出しなので、成否どちらでも AI ログに積まれる
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.aiLogs() });
    },
  });
}

export function useRegisterDomain(): Mutation<
  DomainDetail,
  { name: string; period: number }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (input) => services.domains.register(input),
    onSuccess: (domain) => {
      queryClient.setQueryData(keys.domain(domain.name), domain);
      void queryClient.invalidateQueries({ queryKey: keys.domains() });
    },
  });
}

/** 詳細画面の 1 ドメインに紐づく更新系。成功したら詳細と一覧を取り直す。 */
function useDomainMutation<TData, TVariables>(
  name: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
): Mutation<TData, TVariables> {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.domain(name) });
      void queryClient.invalidateQueries({ queryKey: keys.domains() });
    },
  });
}

export function useRenewDomain(
  name: string,
): Mutation<DomainDetail, { period: number }> {
  const services = useServices();
  return useDomainMutation(name, (input: { period: number }) =>
    services.domains.renew(name, input),
  );
}

export function useUpdateDomain(
  name: string,
): Mutation<DomainDetail, DomainUpdateInput> {
  const services = useServices();
  return useDomainMutation(name, (input: DomainUpdateInput) =>
    services.domains.update(name, input),
  );
}

export function useDeleteDomain(
  name: string,
): Mutation<{ outcome: "rgp" | "deleted" }> {
  const services = useServices();
  return useDomainMutation(name, () => services.domains.remove(name));
}

export function useRestoreDomain(name: string): Mutation<DomainDetail> {
  const services = useServices();
  return useDomainMutation(name, () => services.domains.restore(name));
}

/** D-05: 呼ぶたびに AuthCode が再発行される（前回の値は無効になる）ため mutation。 */
export function useAuthCode(name: string): Mutation<{ authCode: string }> {
  const services = useServices();
  return useMutation({
    mutationFn: () => services.domains.authCode(name),
  });
}

// ---- 候補生成（FR-04 / 05） ----

export function useGenerateCandidates(): Mutation<Candidate[], CandidateInput> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (input) => services.candidates.generate(input),
    // AI 呼び出しは成否どちらでも AI ログに積まれる（ui-screens §1）
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.aiLogs() });
    },
  });
}

// ---- サブドメイン設計（FR-13） ----

export function useSubdomainPlan(domain: string): Query<SubdomainPlan | null> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.subdomainPlan(domain),
    queryFn: () => services.subdomains.get(domain),
    enabled: domain !== "",
  });
}

export function useProposeSubdomains(
  domain: string,
): Mutation<SubdomainPlan, { repoUrl?: string; description?: string }> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (input: { repoUrl?: string; description?: string }) =>
      services.subdomains.propose(domain, input),
    onSuccess: (plan) => {
      queryClient.setQueryData(keys.subdomainPlan(domain), plan);
      void queryClient.invalidateQueries({
        queryKey: keys.dnsDiff(domain),
      });
    },
    // AI 呼び出しは成否どちらでも AI ログに積まれる（ui-screens §1）
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.aiLogs() });
    },
  });
}

export function useSaveSubdomainPlan(
  domain: string,
): Mutation<SubdomainPlan, SubdomainPlan> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (plan: SubdomainPlan) => services.subdomains.save(domain, plan),
    onSuccess: (plan) => {
      queryClient.setQueryData(keys.subdomainPlan(domain), plan);
      void queryClient.invalidateQueries({
        queryKey: keys.dnsDiff(domain),
      });
    },
  });
}

export function useDnsDiff(domain: string): Query<DnsDiff> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.dnsDiff(domain),
    queryFn: () => services.subdomains.diff(domain),
    enabled: domain !== "",
  });
}

export function useApplyDns(domain: string): Mutation<{
  plan: SubdomainPlan;
  added: number;
  updated: number;
  removed: number;
  nameserversChanged: boolean;
}> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: () => services.subdomains.apply(domain),
    onSuccess: (result) => {
      queryClient.setQueryData(keys.subdomainPlan(domain), result.plan);
      void queryClient.invalidateQueries({
        queryKey: keys.dnsDiff(domain),
      });
      // NS 切替がドメイン側のステータス（inactive 解除）に効く
      void queryClient.invalidateQueries({
        queryKey: keys.domain(domain),
      });
      void queryClient.invalidateQueries({ queryKey: keys.domains() });
    },
  });
}

// ---- 移管（FR-12） ----

export function useTransfers(): Query<Transfer[]> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.transfers(),
    queryFn: () => services.transfers.list(),
  });
}

export function useRefreshTransfers(): Mutation<Transfer[]> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: () => services.transfers.refresh(),
    onSuccess: (transfers) => {
      queryClient.setQueryData(keys.transfers(), transfers);
      void queryClient.invalidateQueries({ queryKey: keys.domains() });
    },
  });
}

export function useRequestTransfer(): Mutation<
  Transfer,
  { name: string; authCode: string }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: (input) => services.transfers.request(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.transfers() });
    },
  });
}

export type TransferAction = "approve" | "reject" | "cancel";

/** 受信した申請の承認 / 拒否、自分の申請の取消（D-06 / D-08）。 */
export function useTransferAction(): Mutation<
  Transfer,
  { id: string; action: TransferAction }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ id, action }) => services.transfers[action](id),
    onSuccess: (transfer) => {
      void queryClient.invalidateQueries({ queryKey: keys.transfers() });
      void queryClient.invalidateQueries({ queryKey: keys.domains() });
      void queryClient.invalidateQueries({
        queryKey: keys.domain(transfer.domainName),
      });
    },
  });
}

// ---- ログ（FR-14 / 15） ----

export function useOperationLogs(): Query<OperationLog[]> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.operationLogs(),
    queryFn: () => services.logs.operations(),
  });
}

export function useAiLogs(): Query<AiLog[]> {
  const services = useServices();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.aiLogs(),
    queryFn: () => services.logs.ai(),
  });
}
