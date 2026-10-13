import {
  CataloguedProblemView,
  cataloguedProblemMetadata,
  cataloguedProblemParams,
} from "@/views/problems/detail";

type Props = PageProps<"/problems/[section]/[problem]">;

/**
 * The pair set is decided at request time, not at build time.
 *
 * A problem can be authored and published while the server is running, and a
 * build never sees the library at all, so closing this route to params outside
 * `generateStaticParams` would make every authored problem unreachable. What
 * keeps a pair from having two URLs is not this list: `problemHref` builds one
 * link, `proxy.ts` redirects a catalogued contest's `/contests` addresses, and
 * `CataloguedProblemView` refuses a section that is not catalogued.
 */
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
