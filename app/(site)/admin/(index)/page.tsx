import type { Metadata } from "next";
import { AdminOverviewView } from "@/views/admin/overview";

export const metadata: Metadata = { title: "管理" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <AdminOverviewView />;
}
