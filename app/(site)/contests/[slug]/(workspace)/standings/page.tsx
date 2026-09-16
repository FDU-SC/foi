import { StandingsView, standingsMetadata } from "@/views/contests/standings";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PageProps<"/contests/[slug]/standings">) {
  return standingsMetadata(props);
}

export default function Page(props: PageProps<"/contests/[slug]/standings">) {
  return <StandingsView {...props} />;
}
