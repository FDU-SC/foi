import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { contestFor } from "@/lib/contests/access";
import { isCatalogue } from "@/lib/contests/catalogue";
import {
  ContestWorkspace,
  ContestWorkspaceEmpty,
} from "@/views/contests/workspace";

type Props = PageProps<"/problems/[section]">;

function sectionFor(section: string) {
  return isCatalogue(section) ? section : undefined;
}

export async function problemListMetadata({
  params,
}: Props): Promise<Metadata> {
  const { section } = await params;
  const slug = sectionFor(section);
  const view = slug ? contestFor(slug, await getViewer()) : undefined;

  return { title: view?.config.title ?? "题库" };
}

/**
 * One catalogued contest's problem set. The section segment is a contest
 * slug, but only a catalogued one answers here.
 */
export async function ProblemListView({ params, searchParams }: Props) {
  const [{ section }, query] = await Promise.all([params, searchParams]);

  const mounted = sectionFor(section);
  if (mounted === undefined) notFound();

  return (
    <ContestWorkspace contestSlug={mounted} searchParams={query}>
      <ContestWorkspaceEmpty />
    </ContestWorkspace>
  );
}
