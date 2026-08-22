import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createUserAction, toggleUserAction } from "../actions";

export const metadata: Metadata = { title: "用户管理" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const all = await db.select().from(users).orderBy(asc(users.createdAt));

  return (
    <div className="space-y-6">
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>用户</span>
      </nav>

      <h1 className="text-fg text-2xl font-bold tracking-tight">用户</h1>

      <Card>
        <CardHeader title="新建账号" />
        <CardBody>
          <ActionForm action={createUserAction} submitLabel="创建">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="用户名">
                <Input name="handle" required autoComplete="off" />
              </Field>
              <Field label="显示名">
                <Input name="displayName" required autoComplete="off" />
              </Field>
              <Field label="初始密码" hint="至少 8 位">
                <Input name="password" required minLength={8} />
              </Field>
              <Field label="角色">
                <Select name="role" defaultValue="user">
                  <option value="user">选手</option>
                  <option value="admin">管理员</option>
                </Select>
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr className="text-fg-muted text-xs">
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                用户名
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                显示名
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                角色
              </th>
              <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {all.map((user) => (
              <tr key={user.id} className="hover:bg-surface-2/60">
                <td className="text-fg px-4 py-2.5 font-mono text-xs">
                  {user.handle}
                </td>
                <td className="text-fg px-4 py-2.5">{user.displayName}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={user.role === "admin" ? "primary" : "neutral"}>
                    {user.role === "admin" ? "管理员" : "选手"}
                  </Badge>
                  {user.disabled ? (
                    <Badge tone="err" className="ml-1.5">
                      已停用
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <form action={toggleUserAction.bind(null, user.id)}>
                    <Button
                      type="submit"
                      size="sm"
                      variant={user.disabled ? "secondary" : "ghost"}
                    >
                      {user.disabled ? "恢复" : "停用"}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
