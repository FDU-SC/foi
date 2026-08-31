import type { Metadata } from "next";
import { ForgotPasswordView } from "@/views/auth/forgot-password";

export const metadata: Metadata = { title: "找回密码" };

export default function Page() {
  return <ForgotPasswordView />;
}
