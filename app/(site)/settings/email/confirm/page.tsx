import type { Metadata } from "next";
import { EmailConfirmView } from "@/views/settings/email-confirm";

export const metadata: Metadata = { title: "确认修改邮箱" };

export default function Page(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <EmailConfirmView {...props} />;
}
