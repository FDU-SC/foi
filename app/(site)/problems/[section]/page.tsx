import { ProblemListView, problemListMetadata } from "@/views/problems/list";

type Props = PageProps<"/problems/[section]">;

export const dynamic = "force-dynamic";

export function generateMetadata(props: Props) {
  return problemListMetadata(props);
}

export default function Page(props: Props) {
  return <ProblemListView {...props} />;
}
