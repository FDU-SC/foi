import type { Metadata } from "next";
import { SubmissionListView } from "@/views/submissions/list";

export const metadata: Metadata = { title: "提交记录" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <SubmissionListView />;
}
