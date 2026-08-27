import type { RegistryId } from "@dopamin/shared";
import type { ApiClientError, ClientErrorCode } from "@/lib/api/errors";
import type { DomainSummary, SyncFailure } from "@/lib/api/types";
import { REGISTRY_LABEL } from "./registry-label";

/**
 * S-13 の同期エラー Banner（FR-02 / AC-18-1）の文言。
 *
 * Next.js の Page モジュールは `default` と決められたメタデータ以外を export できないため
 * （`auto-sync.ts` と同じ制約）、純粋関数はここに置いてテストもここから読む。
 *
 * 語彙: データを取り直す**操作**は「最新化」、その結果として持っている**状態**は「同期」
 * （最終同期 / 未同期）で統一する。ボタンは「最新化」、メタ・バッジは「同期」。
 *
 * 見出しと案内は**失敗コードで出し分ける**（#184）。`failures[].code` には
 * `REGISTRY_UNAVAILABLE` 以外（`NOT_FOUND` / `REGISTRY_REJECTED` /
 * `REGISTRY_SPEC_MISMATCH` / `VALIDATION_ERROR` …）も届くので、固定で
 * 「〇〇が応答しません」と出すとレジストリ障害でないものが障害に見え、切り分けが空振りする。
 */

export interface SyncNotice {
  title: string;
  body: string;
}

export interface SyncNoticeInput {
  /** リクエスト自体が失敗したとき（401 / 5xx / ネットワーク）。部分失敗ではない。 */
  error: ApiClientError | null;
  /** 200 で返った部分失敗（S-13 の本命）。 */
  failures: readonly SyncFailure[];
  /** 現在表示している一覧。落ちた相手を特定する最後の手がかりに使う。 */
  domains: readonly DomainSummary[];
}

/**
 * 失敗コードの区分。見出し・案内・「再試行したかどうか」が同じコードを 1 つにまとめる。
 * `unavailable` だけが自動再試行の対象で、API の `withReadRetry`
 * （`apps/api/src/lib/retry.ts` の `isRetryable`）と同じ範囲にしてある。
 */
type FailureKind =
  | "unavailable"
  | "spec_mismatch"
  | "rejected"
  | "not_found"
  | "other";

/**
 * 重い順。コードが混ざったときは、ここで先に来る区分の文言を採る。
 * 疎通障害が 1 件でも混ざっていれば「待って再試行」が最も行動につながるので先頭に置く。
 */
const KIND_ORDER: readonly FailureKind[] = [
  "unavailable",
  "spec_mismatch",
  "rejected",
  "not_found",
  "other",
];

const KIND_BY_CODE: Partial<Record<ClientErrorCode, FailureKind>> = {
  REGISTRY_TIMEOUT: "unavailable",
  REGISTRY_UNAVAILABLE: "unavailable",
  REGISTRY_SPEC_MISMATCH: "spec_mismatch",
  REGISTRY_REJECTED: "rejected",
  NOT_FOUND: "not_found",
};

interface KindCopy {
  /** 見出し。`{registry}` は落ちた相手（特定できなければ総称）に差し替える。 */
  title: string;
  /** 件数に続ける案内。理由が 1 つに定まらないときの受け皿も兼ねる。 */
  guidance: string;
  /** コードが混ざったときの内訳に使う短い呼び名。 */
  label: string;
  /**
   * true なら API の `message`（= レジストリの result code に対応する理由。
   * `packages/shared/src/registry-codes.ts` の表を API が引いて載せている）を案内より優先する。
   * 見出しの言い換えにしかならない区分では false にして、本文の重複を避ける。
   */
  preferMessage?: boolean;
}

const COPY: Record<FailureKind, KindCopy> = {
  unavailable: {
    // AC-18-1 / #130 の完了条件。疎通障害のときの文言は変えない
    title: "{registry}が応答しません — 一覧はキャッシュを表示しています",
    guidance:
      "自動で 2 回試し直しました。しばらくして「最新化」を押してください。",
    label: "応答なし",
  },
  spec_mismatch: {
    // 見出しは事実だけにして、原因の推測（仕様変更）は本文に回す
    title: "{registry}の応答が想定と異なります",
    guidance:
      "レジストリの仕様が変わった可能性があります。操作ログを確認してください。",
    label: "想定外の応答",
  },
  rejected: {
    title:
      "{registry}が最新化を拒否しました — 一覧はキャッシュを表示しています",
    guidance: "操作ログで理由を確認してください。",
    label: "拒否",
    preferMessage: true,
  },
  not_found: {
    // 再試行の対象外（`isRetryable` が false）なので「再試行しました」とは書かない
    title:
      "{registry}に登録が見つかりません — 一覧はキャッシュを表示しています",
    guidance:
      "レジストリ側に登録がありません。操作ログで詳細を確認してください。",
    label: "レジストリに未登録",
  },
  other: {
    // レジストリ由来と限らない（VALIDATION_ERROR / INTERNAL …）ので相手を名指ししない
    title: "一覧を最新化できませんでした — キャッシュを表示しています",
    guidance: "時間をおいて「最新化」を押してください。",
    label: "その他",
    preferMessage: true,
  },
};

function kindOf(code: ClientErrorCode): FailureKind {
  return KIND_BY_CODE[code] ?? "other";
}

/**
 * 文言の基準にする区分。部分失敗（`failures`）とリクエストごとの失敗（`error`）の
 * 両方のコードを見て、最も重いものを採る。
 */
function dominantKind(input: SyncNoticeInput): FailureKind {
  const kinds = new Set(input.failures.map((failure) => kindOf(failure.code)));
  if (input.error !== null) {
    kinds.add(kindOf(input.error.code));
  }
  return KIND_ORDER.find((kind) => kinds.has(kind)) ?? "other";
}

/**
 * 落ちたレジストリを特定する。
 * `failures` が名指ししていればそれが正、無ければエラー、それも無ければ stale なカードから推定する。
 *
 * `failures` を見るのは見出しに採った区分の分だけ。コードが混ざっているときに
 * 全件から集めると、疎通障害は片方だけなのに「両レジストリが応答しません」になってしまう。
 */
function downRegistries(
  input: SyncNoticeInput,
  kind: FailureKind,
): RegistryId[] {
  const fromFailures = new Set<RegistryId>(
    input.failures.flatMap((failure) =>
      failure.registry === null || kindOf(failure.code) !== kind
        ? []
        : [failure.registry],
    ),
  );
  if (fromFailures.size > 0) {
    return [...fromFailures];
  }
  if (input.error?.registry !== undefined) {
    return [input.error.registry];
  }
  return [
    ...new Set(
      input.domains
        .filter((domain) => domain.stale)
        .map((domain) => domain.registry),
    ),
  ];
}

/** 「Kitaqsign が応答しません」の主語。特定できなければ総称にする。 */
function subjectOf(registries: readonly RegistryId[]): string {
  if (registries.length >= 2) {
    return "両レジストリ";
  }
  const only = registries[0];
  return only === undefined ? "レジストリ" : REGISTRY_LABEL[only];
}

function titleFor(
  kind: FailureKind,
  registries: readonly RegistryId[],
): string {
  const subject = subjectOf(registries);
  // 英字のレジストリ名のときだけ和文との間に半角スペースを入れる
  const separator = /[A-Za-z0-9]$/.test(subject) ? " " : "";
  return COPY[kind].title.replaceAll("{registry}", `${subject}${separator}`);
}

/**
 * 「n 件が最新化できませんでした。」。コードが混ざるときだけ内訳を添える
 * （混ざったまま 1 つの見出しに寄せると、見出しに出ていない失敗が見えなくなるため）。
 */
function countPart(failures: readonly SyncFailure[]): string {
  if (failures.length === 0) {
    return "";
  }
  const counts = new Map<FailureKind, number>();
  for (const failure of failures) {
    const kind = kindOf(failure.code);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const breakdown =
    counts.size < 2
      ? ""
      : `（${KIND_ORDER.filter((kind) => counts.has(kind))
          .map((kind) => `${COPY[kind].label} ${counts.get(kind)} 件`)
          .join("・")}）`;
  return `${failures.length} 件が最新化できませんでした${breakdown}。`;
}

/**
 * その区分の失敗が挙げている理由。1 つに定まるときだけ本文に出す
 * （バラバラの理由を並べるより操作ログへ送ったほうが早い）。
 */
function reasonOf(
  failures: readonly SyncFailure[],
  kind: FailureKind,
): string | null {
  const messages = [
    ...new Set(
      failures
        .filter((failure) => kindOf(failure.code) === kind)
        .map((failure) => failure.message.trim())
        .filter((message) => message !== ""),
    ),
  ];
  return messages.length === 1 ? (messages[0] ?? null) : null;
}

/** 文末に句点が無ければ足す（案内の文と続けても切れ目が分かるように）。 */
function sentence(text: string): string {
  return /[。．.!！?？」]$/u.test(text) ? text : `${text}。`;
}

/**
 * 同期の結果から Banner を作る。出す必要が無ければ null。
 *
 * 部分失敗（`failures`）とリクエストごとの失敗（`error`）の両方をここで扱う。
 * 部分失敗のときだけ「n 件が最新化できませんでした」を添えて、
 * 一覧の一部だけが古いことを明示する。
 *
 * 「最終同期 n 分前」は Banner に書かない。S-13 では stale なカード自身が
 * 「最終同期 n 分前」を持ち、ヘッダーメタも一覧全体の最終同期を出すので、
 * Banner にもう 1 つ別の基準の時刻を並べると値が食い違って見える。
 */
export function syncNotice(input: SyncNoticeInput): SyncNotice | null {
  if (input.error === null && input.failures.length === 0) {
    return null;
  }

  const kind = dominantKind(input);
  const copy = COPY[kind];
  const reason =
    copy.preferMessage === true ? reasonOf(input.failures, kind) : null;

  return {
    title: titleFor(kind, downRegistries(input, kind)),
    body: `${countPart(input.failures)}${reason === null ? copy.guidance : sentence(reason)}`,
  };
}
