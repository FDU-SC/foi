import type { Metadata } from "next";
import { SubmissionDetailView } from "@/views/submissions/detail";

export const metadata: Metadata = { title: "提交详情" };

export const dynamic = "force-dynamic";

export default function Page(props: PageProps<"/submissions/[id]">) {
  return <SubmissionDetailView {...props} />;
}
