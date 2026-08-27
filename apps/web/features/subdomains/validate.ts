/**
 * 設計（FR-13）の入力検証（S-43）。
 *
 * 契約は `packages/shared` の `savedSubdomainProposalSchema`（`PUT /domains/:name/subdomain-plan`）。
 * 形の判定はそのスキーマ部品（`subdomainHostSchema` / `dnsTargetSchema` / `isIpv4`）と
 * 上限の定数に委ね、ここでは「どの欄か」と日本語の文言だけを決める。画面側で
 * 文字数や件数の数値を持たないので、契約が変わってもここは追随不要。
 *
 * これが無いと、ホストを追加した直後（用途・向き先が空）や全部消したあとに保存すると、
 * サーバーの 400 が Error Card で返るだけになる（http モード配線 #187 で表面化）。
 * ブラウザ内モックは受け付けていたため、mock と http で挙動が割れていた。
 */

import {
  dnsTargetSchema,
  isIpv4,
  MAX_SUBDOMAIN_ITEMS,
  MAX_SUBDOMAIN_POLICY_LENGTH,
  MAX_SUBDOMAIN_PURPOSE_LENGTH,
  MIN_SUBDOMAIN_ITEMS,
  subdomainHostSchema,
} from "@dopamin/shared";
import type { SubdomainHost, SubdomainPlan } from "@/lib/api/types";

/** 欄ごとのエラー文言。値が無い欄は正常。 */
export interface HostFieldErrors {
  host?: string;
  purpose?: string;
  target?: string;
}

/** ホスト名（1 ラベルまたは apex の `@`）。重複は `hostFieldErrors` 側で見る。 */
function hostNameError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "ホスト名を入力してください";
  }
  if (!subdomainHostSchema.safeParse(trimmed).success) {
    return "ホスト名は 1 ラベル（英数字とハイフン）または apex の @ で指定してください";
  }
  return undefined;
}

function purposeError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "用途を入力してください";
  }
  if (trimmed.length > MAX_SUBDOMAIN_PURPOSE_LENGTH) {
    return `用途は ${MAX_SUBDOMAIN_PURPOSE_LENGTH} 文字までです`;
  }
  return undefined;
}

/** 向き先。A は IPv4、CNAME / ALIAS はホスト名（`checkRecordTypeAgainstTarget` と同じ規則）。 */
function targetError(
  recordType: SubdomainHost["recordType"],
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "向き先を入力してください";
  }
  if (!dnsTargetSchema.safeParse(trimmed).success) {
    return "向き先は IPv4 アドレスまたはホスト名で指定してください";
  }
  if (recordType === "A" && !isIpv4(trimmed)) {
    return "A レコードの向き先は IPv4 アドレスで指定してください（例 203.0.113.10）";
  }
  if (recordType !== "A" && isIpv4(trimmed)) {
    return `${recordType} レコードの向き先はホスト名で指定してください（例 cname.example.com）`;
  }
  return undefined;
}

/**
 * 1 ホストぶんの欄エラー。重複判定のため設計の全ホストを渡す
 * （自分自身は id で除く。比較キーは契約と同じく小文字・前後空白なし）。
 */
export function hostFieldErrors(
  host: SubdomainHost,
  hosts: readonly SubdomainHost[],
): HostFieldErrors {
  const key = host.host.trim().toLowerCase();
  const duplicated =
    key.length > 0 &&
    hosts.some(
      (other) =>
        other.id !== host.id && other.host.trim().toLowerCase() === key,
    );

  return {
    ...(duplicated
      ? { host: "同じホスト名が重複しています" }
      : withKey("host", hostNameError(host.host))),
    ...withKey("purpose", purposeError(host.purpose)),
    ...withKey("target", targetError(host.recordType, host.target)),
  };
}

/** `undefined` のキーを持たせないための小道具（`exactOptionalPropertyTypes` 相当の扱い）。 */
function withKey(
  key: keyof HostFieldErrors,
  message: string | undefined,
): HostFieldErrors {
  return message === undefined ? {} : { [key]: message };
}

/** その欄にエラーがあるか。 */
export function hasHostFieldError(errors: HostFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * 保存を止める理由。`hostId` が付いていれば、その行を選び直せば欄にエラーが出る。
 * 先に見つかった 1 件だけを返す（ui-screens §1 と同じく、出す指摘は 1 つに絞る）。
 */
export interface PlanValidationError {
  message: string;
  hostId: string | null;
}

/**
 * 保存前の検証（AC-13-3）。件数 → 全体方針 → 各ホストの欄、の順に見る。
 * 問題が無ければ null（そのまま `PUT` してよい）。
 */
export function validatePlan(plan: SubdomainPlan): PlanValidationError | null {
  if (plan.hosts.length < MIN_SUBDOMAIN_ITEMS) {
    return {
      message: `ホストは ${MIN_SUBDOMAIN_ITEMS} 件以上必要です。ホストを追加してください`,
      hostId: null,
    };
  }
  if (plan.hosts.length > MAX_SUBDOMAIN_ITEMS) {
    return {
      message: `ホストは ${MAX_SUBDOMAIN_ITEMS} 件までです`,
      hostId: null,
    };
  }
  const policy = plan.policy.trim();
  if (policy.length === 0) {
    return { message: "全体方針を入力してください", hostId: null };
  }
  if (policy.length > MAX_SUBDOMAIN_POLICY_LENGTH) {
    return {
      message: `全体方針は ${MAX_SUBDOMAIN_POLICY_LENGTH} 文字までです`,
      hostId: null,
    };
  }

  for (const host of plan.hosts) {
    const errors = hostFieldErrors(host, plan.hosts);
    const message = errors.host ?? errors.purpose ?? errors.target;
    if (message !== undefined) {
      // 「www: 用途を入力してください」。ツリーのどの行かが一目で分かるようにする
      const label = host.host.trim().length === 0 ? "（名前なし）" : host.host;
      return { message: `${label}: ${message}`, hostId: host.id };
    }
  }
  return null;
}

/** これ以上ホストを追加できるか（契約は 1〜8 件）。 */
export function canAddHost(hosts: readonly SubdomainHost[]): boolean {
  return hosts.length < MAX_SUBDOMAIN_ITEMS;
}
