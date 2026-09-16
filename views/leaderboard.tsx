import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { siteViews } from "@/lib/site-views";

import { catalogueLeaderboards, leaderboardHref } from "@/lib/contests/catalogue";

export async function LeaderboardView({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  const board = (await searchParams)?.board;
  if (board !== undefined && (
    typeof board !== "string" ||
    !catalogueLeaderboards().some((item) => item.id === board)
  )) notFound();
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(leaderboardHref(board))}`);
  if (!allows("leaderboard.read", null, viewerFor(user))) notFound();
  const Board = siteViews.Leaderboard;
  if (!Board) notFound();
  return <Board board={board} />;
}
