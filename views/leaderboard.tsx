import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { siteViews } from "@/lib/site-views";

export async function LeaderboardView() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/leaderboard");
  if (!allows("leaderboard.read", null, viewerFor(user))) notFound();
  const Board = siteViews.Leaderboard;
  if (!Board) notFound();
  return <Board />;
}
