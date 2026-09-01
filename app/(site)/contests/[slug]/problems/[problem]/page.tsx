import {
  ProblemDetailView,
  problemDetailMetadata,
  problemDetailParams,
} from "@/views/problems/detail";

type Props = PageProps<"/contests/[slug]/problems/[problem]">;

export const dynamicParams = false;
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return problemDetailParams();
}

export function generateMetadata(props: Props) {
  return problemDetailMetadata(props);
}

export default function Page(props: Props) {
  return <ProblemDetailView {...props} />;
}
