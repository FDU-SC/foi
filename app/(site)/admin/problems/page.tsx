import type { Metadata } from "next";
import { AdminProblemsView } from "@/views/admin/problems";

export const metadata: Metadata = { title: "题目" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <AdminProblemsView />;
}
