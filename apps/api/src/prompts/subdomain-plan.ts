import { DNS_RECORD_TYPES, SUBDOMAIN_PRIORITIES } from "@dopamin/shared";
import type { RepoSummary } from "../lib/github";

/**
 * サブドメイン提案のプロンプト（docs/requirements.md §13.2 / FR-13）。
 *
 * 要点（§13.2）: 入力はリポ解析結果の JSON。`www` は必ず含める。
 * モノレポ構造（`apps/*`）ごとに 1 ホスト提案。`priority` は 必須 / 推奨 / 任意。
 *
 * 出力は `subdomainProposalSchema`（packages/shared）で必ず再検証する（§13.1）。
 */

/** README とマニフェストはプロンプトに載せる分を切り詰める（トークン量の抑制）。 */
const README_PROMPT_CHARS = 2_000;
const MANIFEST_PROMPT_CHARS = 500;

export const SUBDOMAIN_PLAN_INSTRUCTIONS = `あなたはドメインのサブドメイン構成を設計するアシスタントです。
与えられたプロジェクトの情報から、そのドメインで使うサブドメインの構成を提案します。

守るべき制約:
- 提案は 3〜8 件。
- ホストは必ず 1 ラベル（英数字とハイフンのみ、先頭と末尾はハイフン不可）か、apex を表す "@" のいずれか。ドットを含めない。
- 入口となる "www" は必ず含める。
- モノレポの構造（apps/* など）が分かる場合は、アプリごとに 1 ホストを割り当てる。
- recordType は ${DNS_RECORD_TYPES.join(" / ")} のいずれか。A の target は IPv4 アドレス、CNAME と ALIAS の target はホスト名にする。
- target は実在のホスティング先（例: Vercel なら cname.vercel-dns.com、GitHub Pages なら <owner>.github.io）を想定した値にする。
- priority は ${SUBDOMAIN_PRIORITIES.join(" / ")} のいずれか（必須 / 推奨 / 任意に対応）。
- purpose は日本語で 100 字以内。そのホストが何に使われるかを書く。
- policy は日本語で 120 字以内。構成全体の方針を 1〜2 文で書く。
- 同じホストを 2 回以上出さない。`;

/** 文字列を最大長で切る（末尾を落とすだけ。プロンプト用なので省略記号は付けない）。 */
function clip(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

/** リポジトリ解析の結果をプロンプト用のテキストにする。 */
function describeRepo(summary: RepoSummary): string[] {
  return [
    `リポジトリ: ${summary.owner}/${summary.repo}`,
    `説明: ${summary.description ?? "（なし）"}`,
    `トピック: ${summary.topics.length === 0 ? "（なし）" : summary.topics.join(", ")}`,
    `使用言語（多い順）: ${summary.languages.length === 0 ? "（不明）" : summary.languages.join(", ")}`,
    `ルート直下: ${summary.rootEntries.map((e) => (e.type === "dir" ? `${e.name}/` : e.name)).join(", ")}`,
    `構造ヒント: ${summary.structureHints.length === 0 ? "（なし）" : summary.structureHints.join(", ")}`,
    ...summary.manifests.map(
      (manifest) =>
        `${manifest.path}:\n${clip(manifest.excerpt, MANIFEST_PROMPT_CHARS)}`,
    ),
    `README（抜粋）:\n${summary.readmeExcerpt === null ? "（なし）" : clip(summary.readmeExcerpt, README_PROMPT_CHARS)}`,
  ];
}

/**
 * サブドメイン提案のユーザープロンプト。
 * リポジトリを取得できない場合はユーザーが入力した概要テキストだけで組み立てる（AC-13-2）。
 */
export function buildSubdomainPlanPrompt(input: {
  domain: string;
  summary: RepoSummary | null;
  description: string | null;
}): string {
  return [
    `対象ドメイン: ${input.domain}`,
    ...(input.summary === null ? [] : describeRepo(input.summary)),
    ...(input.description === null
      ? []
      : [`プロジェクト概要（ユーザー入力）:\n${input.description}`]),
  ].join("\n");
}
