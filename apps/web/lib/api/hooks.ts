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
import type { ApiClientError } from "./errors";
import { useServices } from "./provider";
import type { CandidateService } from "./services";
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

/** queryKey の一覧（fe-ui 設計 §4.5）。invalidate はここ経由で行う。 */
export const queryKeys = {
  me: () => ["me"] as const,
  passkeys: () => ["passkeys"] as const,
  domains: () => ["domains"] as const,
  domain: (name: string) => ["domain", name] as const,
  candidates: (input: CandidateInput) => ["candidates", input] as const,
  subdomainPlan: (domain: string) => ["subdomain-plan", domain] as const,
  dnsDiff: (domain: string) => ["dns-diff", domain] as const,
  transfers: () => ["transfers"] as const,
  operationLogs: () => ["logs", "operations"] as const,
  aiLogs: () => ["logs", "ai"] as const,
} as const;

type Query<T> = UseQueryResult<T, ApiClientError>;
type Mutation<TData, TVariables = void> = UseMutationResult<
  TData,
  ApiClientError,
  TVariables
>;

// ---- 設定・ユーザー（FR-01 / 16 / 17） ----

export function useMe(): Query<Me> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => services.settings.me(),
  });
}

export function useUpdateAiSettings(): Mutation<
  AiSettings,
  { provider: AiSettings["provider"]; model: string }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => services.settings.updateAi(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
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
  return useQuery({
    queryKey: queryKeys.passkeys(),
    queryFn: () => services.auth.listPasskeys(),
  });
}

export function useAddPasskey(): Mutation<PasskeySummary> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => services.auth.addPasskey(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.passkeys() });
    },
  });
}

export function useDeletePasskey(): Mutation<void, string> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => services.auth.deletePasskey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.passkeys() });
    },
  });
}

// ---- ドメイン（FR-02 / 03 / 06〜12） ----

export function useDomains(): Query<DomainSummary[]> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.domains(),
    queryFn: () => services.domains.list(),
  });
}

export function useSyncDomains(): Mutation<DomainSummary[]> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => services.domains.sync(),
    onSuccess: (domains) => {
      queryClient.setQueryData(queryKeys.domains(), domains);
    },
  });
}

export function useDomain(name: string): Query<DomainDetail> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.domain(name),
    queryFn: () => services.domains.get(name),
    enabled: name !== "",
  });
}

export function useCheckDomains(): Mutation<
  SearchResult[],
  DomainCheckRequest
> {
  const services = useServices();
  return useMutation({
    mutationFn: (input) => services.domains.check(input),
  });
}

export function useRegisterDomain(): Mutation<
  DomainDetail,
  { name: string; period: number }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => services.domains.register(input),
    onSuccess: (domain) => {
      queryClient.setQueryData(queryKeys.domain(domain.name), domain);
      void queryClient.invalidateQueries({ queryKey: queryKeys.domains() });
    },
  });
}

/** 詳細画面の 1 ドメインに紐づく更新系。成功したら詳細と一覧を取り直す。 */
function useDomainMutation<TData, TVariables>(
  name: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
): Mutation<TData, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(name) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.domains() });
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
): Mutation<DomainDetail, { nameservers?: string[] }> {
  const services = useServices();
  return useDomainMutation(name, (input: { nameservers?: string[] }) =>
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
  return useMutation({
    mutationFn: (input) => services.candidates.generate(input),
  });
}

// ---- サブドメイン設計（FR-13） ----

export function useSubdomainPlan(domain: string): Query<SubdomainPlan | null> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.subdomainPlan(domain),
    queryFn: () => services.subdomains.get(domain),
    enabled: domain !== "",
  });
}

export function useProposeSubdomains(
  domain: string,
): Mutation<SubdomainPlan, { repoUrl?: string; description?: string }> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { repoUrl?: string; description?: string }) =>
      services.subdomains.propose(domain, input),
    onSuccess: (plan) => {
      queryClient.setQueryData(queryKeys.subdomainPlan(domain), plan);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dnsDiff(domain),
      });
    },
  });
}

export function useSaveSubdomainPlan(
  domain: string,
): Mutation<SubdomainPlan, SubdomainPlan> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plan: SubdomainPlan) => services.subdomains.save(domain, plan),
    onSuccess: (plan) => {
      queryClient.setQueryData(queryKeys.subdomainPlan(domain), plan);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dnsDiff(domain),
      });
    },
  });
}

export function useDnsDiff(domain: string): Query<DnsDiff> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.dnsDiff(domain),
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
  return useMutation({
    mutationFn: () => services.subdomains.apply(domain),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.subdomainPlan(domain), result.plan);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dnsDiff(domain),
      });
      // NS 切替がドメイン側のステータス（inactive 解除）に効く
      void queryClient.invalidateQueries({
        queryKey: queryKeys.domain(domain),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.domains() });
    },
  });
}

// ---- 移管（FR-12） ----

export function useTransfers(): Query<Transfer[]> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.transfers(),
    queryFn: () => services.transfers.list(),
  });
}

export function useRefreshTransfers(): Mutation<Transfer[]> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => services.transfers.refresh(),
    onSuccess: (transfers) => {
      queryClient.setQueryData(queryKeys.transfers(), transfers);
      void queryClient.invalidateQueries({ queryKey: queryKeys.domains() });
    },
  });
}

export function useRequestTransfer(): Mutation<
  Transfer,
  { name: string; authCode: string }
> {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => services.transfers.request(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.transfers() });
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
  return useMutation({
    mutationFn: ({ id, action }) => services.transfers[action](id),
    onSuccess: (transfer) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.transfers() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.domains() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.domain(transfer.domainName),
      });
    },
  });
}

// ---- ログ（FR-14 / 15） ----

export function useOperationLogs(): Query<OperationLog[]> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.operationLogs(),
    queryFn: () => services.logs.operations(),
  });
}

export function useAiLogs(): Query<AiLog[]> {
  const services = useServices();
  return useQuery({
    queryKey: queryKeys.aiLogs(),
    queryFn: () => services.logs.ai(),
  });
}
