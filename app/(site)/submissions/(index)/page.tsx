import type { Metadata } from "next";
import { SubmissionListView } from "@/views/submissions/list";

export const metadata: Metadata = { title: "我的提交" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <SubmissionListView />;
}
