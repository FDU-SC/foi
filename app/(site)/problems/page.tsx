import type { Metadata } from "next";
import { ProblemListView } from "@/views/problems/list";

export const metadata: Metadata = { title: "题库" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <ProblemListView />;
}
