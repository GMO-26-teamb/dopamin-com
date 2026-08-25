import { SubdomainsScreen } from "@/features/subdomains/subdomains-screen";

/**
 * S-40 〜 S-46 サブドメイン設計（FR-13）。
 * データ取得はすべてクライアント側の hooks が行うので、ここは params を解いて渡すだけ。
 */
export default async function SubdomainsPage({
  params,
}: PageProps<"/domains/[name]/subdomains">) {
  const { name } = await params;
  return <SubdomainsScreen domain={decodeURIComponent(name)} />;
}
