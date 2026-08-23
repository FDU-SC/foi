import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "设置密码" };

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  if (await getSessionUser()) redirect("/");

  const { handle } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xs">
        <Link
          href="/"
          className="text-fg mb-8 block text-center text-2xl font-bold tracking-tight"
        >
          FOI
        </Link>
        <SetupForm handle={typeof handle === "string" ? handle : ""} />
        <p className="text-fg-subtle mt-6 text-center text-xs leading-relaxed">
          第一次登录，或忘记密码时使用。
          <br />
          已有密码请直接{" "}
          <Link href="/login" className="hover:text-fg underline">
            登录
          </Link>
          。
        </p>
      </div>
    </div>
  );
}
