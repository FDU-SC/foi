import type { Metadata } from "next";
import { LoginView } from "@/views/auth/login";

export const metadata: Metadata = { title: "登录" };

export default function Page(props: PageProps<"/login">) {
  return <LoginView {...props} />;
}
