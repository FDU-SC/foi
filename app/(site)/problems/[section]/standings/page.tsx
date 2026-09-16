import {
  CatalogueStandingsView,
  catalogueStandingsMetadata,
} from "@/views/contests/standings";

type Props = PageProps<"/problems/[section]/standings">;

export const dynamic = "force-dynamic";

export function generateMetadata(props: Props) {
  return catalogueStandingsMetadata(props);
}

export default function Page(props: Props) {
  return <CatalogueStandingsView {...props} />;
}
