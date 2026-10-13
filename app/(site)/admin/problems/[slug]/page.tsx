import type { Metadata } from "next";
import { AdminProblemView } from "@/views/admin/problem";

type Props = PageProps<"/admin/problems/[slug]">;

export const metadata: Metadata = { title: "编辑题目" };

export const dynamic = "force-dynamic";

export default function Page(props: Props) {
  return <AdminProblemView {...props} />;
}
