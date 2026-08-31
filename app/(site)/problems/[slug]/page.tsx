import {
  ProblemDetailView,
  problemDetailMetadata,
  problemDetailParams,
} from "@/views/problems/detail";

export const dynamicParams = false;

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return problemDetailParams();
}

export function generateMetadata(props: PageProps<"/problems/[slug]">) {
  return problemDetailMetadata(props);
}

export default function Page(props: PageProps<"/problems/[slug]">) {
  return <ProblemDetailView {...props} />;
}
