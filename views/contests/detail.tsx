import type { Metadata } from "next";
import { contestFor } from "@/lib/contests/access";
import { getViewer } from "@/auth";
import {
  ContestWorkspace,
  ContestWorkspaceEmpty,
} from "@/views/contests/workspace";

export async function contestDetailMetadata({
  params,
}: PageProps<"/contests/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  return { title: view?.config.title ?? "比赛" };
}

export async function ContestDetailView({
  params,
}: PageProps<"/contests/[slug]">) {
  const { slug } = await params;
  return (
    <ContestWorkspace contestSlug={slug}>
      <ContestWorkspaceEmpty />
    </ContestWorkspace>
  );
}
