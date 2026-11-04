import type { Metadata } from "next";
import { AdminRunnersView } from "@/views/admin/runners";

export const metadata: Metadata = { title: "评测机令牌" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <AdminRunnersView />;
}
