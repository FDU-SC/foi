import type { Metadata } from "next";
import { LeaderboardView } from "@/views/leaderboard";

export const metadata: Metadata = { title: "练习排行榜" };

export const dynamic = "force-dynamic";

export default function Page(props: PageProps<"/leaderboard">) {
  return <LeaderboardView {...props} />;
}
