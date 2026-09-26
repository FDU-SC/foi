import { CatalogueShellView } from "@/views/catalogue/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CatalogueShellView>{children}</CatalogueShellView>;
}
