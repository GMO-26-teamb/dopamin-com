/**
 * エラーコード → 画面文言（docs/specs/ui-screens.md §4 の表を 1 か所に集約）。
 *
 * 文言は表の「文言（例）」列に合わせる。`{registry}` は `error.registry` から
 * 「Kitaqsign」/「Kitaqnic」に差し替える（fe-ui 設計 §4.3）。
 * 本文はサーバーが返した `message` を優先し、無ければ既定文を使う。
 */

import type { RegistryId } from "@dopamin/shared";
import { z } from "zod";
import type { ApiClientError, ClientErrorCode } from "./api/errors";

export interface ErrorCopy {
  title: string;
  body: string;
  action: "retry" | "login" | "dashboard" | "none";
}

const REGISTRY_LABEL: Record<RegistryId, string> = {
  kitaqsign: "Kitaqsign",
  kitaqnic: "Kitaqnic",
  mock: "モックレジストリ",
};

/** レジストリが特定できないときの総称。 */
const GENERIC_REGISTRY_LABEL = "レジストリ";

/**
 * 移管系の registryCode ごとの理由（docs/requirements.md §10.3）。
 * 【要確認: 実際に返るコード、§21.2 #16】が解決したら追随する。
 */
const REGISTRY_REJECT_REASON: Record<string, string> = {
  "2202": "AuthCode が正しくありません。",
  "2300": "すでに移管申請中です。",
  "2301": "すでに移管申請中です。",
  "2304": "現在のステータスでは移管できません（移管ロックなど）。",
  "2106": "このドメインは移管の対象外です。",
  "2303": "このドメインは登録されていません。",
};

interface CopyTemplate {
  title: string;
  body: string;
  action: ErrorCopy["action"];
}

const COPY: Record<ClientErrorCode, CopyTemplate> = {
  VALIDATION_ERROR: {
    title: "入力内容を確認してください",
    body: "入力した内容に誤りがあります。フィールドの説明を確認して、もう一度お試しください。",
    action: "none",
  },
  UNAUTHORIZED: {
    title: "セッションの有効期限が切れました",
    body: "もう一度ログインしてください。",
    action: "login",
  },
  FORBIDDEN: {
    title: "ページが見つかりません",
    body: "このドメインは表示できません。ダッシュボードから操作してください。",
    action: "dashboard",
  },
  NOT_FOUND: {
    title: "ページが見つかりません",
    body: "お探しのページは存在しないか、移動しました。",
    action: "dashboard",
  },
  CONFLICT: {
    title: "操作を完了できませんでした",
    body: "すでに取得済みか、いまは操作できない状態です。最新の状態を確認してください。",
    action: "none",
  },
  OPERATION_NOT_ALLOWED: {
    title: "ロック中のため実行できません",
    body: "ドメインのステータスにより、この操作は実行できません。",
    action: "none",
  },
  REGISTRY_REJECTED: {
    title: "{registry}が拒否しました",
    body: "入力内容を確認して、もう一度お試しください。",
    action: "none",
  },
  REGISTRY_TIMEOUT: {
    title: "{registry}が応答しませんでした",
    body: "ローカルの情報は変更されていません。結果を確認してから、もう一度お試しください。",
    action: "retry",
  },
  REGISTRY_UNAVAILABLE: {
    title: "{registry}に接続できません",
    body: "しばらく時間をおいてから、もう一度お試しください。",
    action: "retry",
  },
  REGISTRY_SPEC_MISMATCH: {
    title: "レジストリの仕様変更の可能性があります",
    body: "応答の形式が想定と異なりました。操作ログを確認してください。",
    action: "none",
  },
  AI_UNAVAILABLE: {
    title: "AI が利用できません",
    body: "手入力で探せます。",
    action: "none",
  },
  RATE_LIMITED: {
    title: "利用上限に達しました",
    body: "しばらくしてから再試行してください。",
    action: "retry",
  },
  INTERNAL: {
    title: "エラーが発生しました",
    body: "時間をおいて、もう一度お試しください。",
    action: "retry",
  },
  NOT_IMPLEMENTED: {
    title: "この機能はまだ利用できません",
    body: "API が未実装です。モックモード（NEXT_PUBLIC_API_MODE=mock）でお試しください。",
    action: "none",
  },
  NETWORK: {
    title: "通信に失敗しました",
    body: "ネットワーク接続を確認して、もう一度お試しください。",
    action: "retry",
  },
};

const statusesSchema = z.object({ statuses: z.array(z.string()).min(1) });
const retryAfterSchema = z.object({ retryAfter: z.number().positive() });

/**
 * 「{registry}が応答しませんでした」→「Kitaqsign が応答しませんでした」。
 * レジストリ名が無いときは総称（「レジストリが応答しませんでした」）に落とす。
 * 英字のレジストリ名のときだけ後ろに半角スペースを入れる（和文との組版）。
 */
function fillRegistry(
  template: string,
  registry: RegistryId | undefined,
): string {
  const label =
    registry === undefined ? GENERIC_REGISTRY_LABEL : REGISTRY_LABEL[registry];
  const separator = /[A-Za-z0-9]$/.test(label) ? " " : "";
  return template.replaceAll("{registry}", `${label}${separator}`);
}

function bodyFor(error: ApiClientError, fallback: string): string {
  const message = error.message.trim();
  return message === "" ? fallback : message;
}

export function toErrorCopy(error: ApiClientError): ErrorCopy {
  const template = COPY[error.code];
  const title = fillRegistry(template.title, error.registry);

  switch (error.code) {
    case "REGISTRY_REJECTED": {
      const reason =
        error.registryCode === undefined
          ? undefined
          : REGISTRY_REJECT_REASON[error.registryCode];
      const detail = reason ?? bodyFor(error, template.body);
      return {
        title,
        body:
          error.registryCode === undefined
            ? detail
            : `${error.registryCode}: ${detail}`,
        action: template.action,
      };
    }
    case "OPERATION_NOT_ALLOWED": {
      const parsed = statusesSchema.safeParse(error.details);
      const base = bodyFor(error, template.body);
      return {
        title,
        body: parsed.success
          ? `${base}（${parsed.data.statuses.join(" / ")}）`
          : base,
        action: template.action,
      };
    }
    case "RATE_LIMITED": {
      const parsed = retryAfterSchema.safeParse(error.details);
      return {
        title,
        body: parsed.success
          ? `${parsed.data.retryAfter} 秒後に再試行してください。`
          : bodyFor(error, template.body),
        action: template.action,
      };
    }
    case "INTERNAL": {
      const base = bodyFor(error, template.body);
      return {
        title,
        body:
          error.requestId === undefined
            ? base
            : `${base}（リクエスト ID: ${error.requestId}）`,
        action: template.action,
      };
    }
    default:
      return {
        title,
        body: bodyFor(error, template.body),
        action: template.action,
      };
  }
}
