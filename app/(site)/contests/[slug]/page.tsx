import {
  ContestDetailView,
  contestDetailMetadata,
} from "@/views/contests/detail";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PageProps<"/contests/[slug]">) {
  return contestDetailMetadata(props);
}

export default function Page(props: PageProps<"/contests/[slug]">) {
  return <ContestDetailView {...props} />;
}
