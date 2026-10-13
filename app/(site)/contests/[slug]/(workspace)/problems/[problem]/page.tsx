import {
  ProblemDetailView,
  problemDetailMetadata,
  problemDetailParams,
} from "@/views/problems/detail";

type Props = PageProps<"/contests/[slug]/problems/[problem]">;

/**
 * The pair set is decided at request time, not at build time — a problem can be
 * authored and published while the server is running. Leaving the catalogued
 * pairs out of `generateStaticParams` no longer closes their old addresses
 * either: `proxy.ts` redirects those, and this route is only ever reached for a
 * contest the catalogue does not name.
 */
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
