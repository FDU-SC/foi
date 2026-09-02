import {
  CataloguedProblemView,
  cataloguedProblemMetadata,
  cataloguedProblemParams,
} from "@/views/problems/detail";

type Props = PageProps<"/problems/[slug]">;

export const dynamicParams = false;
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return cataloguedProblemParams();
}

export function generateMetadata(props: Props) {
  return cataloguedProblemMetadata(props);
}

export default function Page(props: Props) {
  return <CataloguedProblemView {...props} />;
}
