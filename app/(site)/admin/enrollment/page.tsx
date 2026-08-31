import type { Metadata } from "next";
import { AdminEnrollmentView } from "@/views/admin/enrollment";

export const metadata: Metadata = { title: "分流规则" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <AdminEnrollmentView />;
}
