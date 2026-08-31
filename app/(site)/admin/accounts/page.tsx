import type { Metadata } from "next";
import { AdminAccountsView } from "@/views/admin/accounts";

export const metadata: Metadata = { title: "账号" };

export const dynamic = "force-dynamic";

export default function Page(props: PageProps<"/admin/accounts">) {
  return <AdminAccountsView {...props} />;
}
