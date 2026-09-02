import {
  CatalogueIndexView,
  catalogueIndexMetadata,
} from "@/views/problems/catalogue";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return catalogueIndexMetadata();
}

export default function Page() {
  return <CatalogueIndexView />;
}
