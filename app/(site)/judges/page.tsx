import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { JudgeStatusBoard } from "@/components/judges/judge-status-board";
import { judgeQueuesFor } from "@/lib/backend/client";

export const metadata: Metadata = { title: "判题机" };
export const dynamic = "force-dynamic";

export default async function JudgesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/judges");

  const visible = await judgeQueuesFor(viewerFor(user));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">判题机</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          FOI 不做提交队列，投递是即时的。排队与并发限流由各判题机自己负责，这里展示的是它们上报的内部队列。
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          目前没有你可以查看的判题机。
        </p>
      ) : (
        <JudgeStatusBoard initial={visible} />
      )}
    </div>
  );
}
