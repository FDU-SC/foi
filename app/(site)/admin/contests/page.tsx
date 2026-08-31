import type { Metadata } from "next";
import { AdminContestsView } from "@/views/admin/contests";

export const metadata: Metadata = { title: "比赛管理" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <AdminContestsView />;
}
