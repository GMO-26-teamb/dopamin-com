import { DomainDetailPage } from "@/features/domains/detail/domain-detail-page";

/**
 * S-30〜S-39 + D-01〜D-07（ui-screens §2.5 / fe-ui 設計 §2）。
 * Next 16 では `params` が Promise なので await してから渡す。
 */
export default async function DomainDetailRoute(
  props: PageProps<"/domains/[name]">,
) {
  const { name } = await props.params;
  return <DomainDetailPage name={decodeURIComponent(name)} />;
}
