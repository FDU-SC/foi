import type { Metadata } from "next";
import { ContestListView } from "@/views/contests/list";

export const metadata: Metadata = { title: "比赛" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <ContestListView />;
}
