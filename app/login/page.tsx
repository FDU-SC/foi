import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");

  const { next } = await searchParams;
  const target = typeof next === "string" ? next : "/";

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xs">
        <Link
          href="/"
          className="text-fg mb-8 block text-center text-2xl font-bold tracking-tight"
        >
          FOI
        </Link>
        <LoginForm next={target} />
        <p className="text-fg-subtle mt-6 text-center text-xs leading-relaxed">
          账号由管理员统一分配。
        </p>
      </div>
    </div>
  );
}
