import type { Metadata } from "next";
import { RegisterView } from "@/views/auth/register";

export const metadata: Metadata = { title: "注册" };

export default function Page(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <RegisterView {...props} />;
}
