import type { Metadata } from "next";
import { SettingsView } from "@/views/settings/account";

export const metadata: Metadata = { title: "个人设置" };

export const dynamic = "force-dynamic";

export default function Page(props: PageProps<"/settings">) {
  return <SettingsView {...props} />;
}
