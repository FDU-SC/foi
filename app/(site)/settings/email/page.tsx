import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { EmailChangeForm } from "./email-change-form";

export const metadata: Metadata = { title: "修改邮箱" };

export default async function SettingsEmailPage() {
  const user = await getResolvedUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">修改邮箱</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          修改邮箱后，你的用户组归属会根据新邮箱重新计算。
        </p>
      </div>

      <div className="bg-surface-2 rounded-md px-4 py-3">
        <p className="text-fg-muted text-xs">当前邮箱</p>
        <p className="text-fg mt-0.5 font-mono text-sm">
          {user.email ?? "未设置"}
        </p>
      </div>

      {user.email ? (
        <EmailChangeForm />
      ) : (
        <p className="text-fg-muted text-sm">
          当前账号没有设置邮箱，无法使用修改邮箱功能。
        </p>
      )}
    </div>
  );
}
