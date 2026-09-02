import {
  CatalogueStandingsView,
  catalogueStandingsMetadata,
} from "@/views/contests/standings";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return catalogueStandingsMetadata();
}

export default function Page() {
  return <CatalogueStandingsView />;
}
