import { ProblemSetView, problemSetMetadata } from "@/views/problems/list";

type Props = PageProps<"/problems/[section]">;

export const dynamic = "force-dynamic";

export function generateMetadata(props: Props) {
  return problemSetMetadata(props);
}

export default function Page(props: Props) {
  return <ProblemSetView {...props} />;
}
