import { ProblemListView, problemListMetadata } from "@/views/problems/list";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return problemListMetadata();
}

export default function Page(props: PageProps<"/problems">) {
  return <ProblemListView {...props} />;
}
