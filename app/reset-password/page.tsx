import type { Metadata } from "next";
import { ResetPasswordView } from "@/views/auth/reset-password";

export const metadata: Metadata = { title: "重置密码" };

export default function Page(props: PageProps<"/reset-password">) {
  return <ResetPasswordView {...props} />;
}
