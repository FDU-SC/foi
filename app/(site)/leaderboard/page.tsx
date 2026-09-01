import type { Metadata } from "next";
import { LeaderboardView } from "@/views/leaderboard";

export const metadata: Metadata = { title: "排行榜" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <LeaderboardView />;
}
