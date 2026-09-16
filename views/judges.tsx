import { PageHeader } from "@/components/ui/page";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { JudgeStatusBoard } from "@/components/judges/judge-status-board";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { judgeQueuesFor } from "@/lib/backend/board";
import { site } from "@/lib/site";

export async function JudgesView() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/judges");

  const viewer = viewerFor(user);
  if (!allows("judge.readBoard", null, viewer)) notFound();

  const visible = await judgeQueuesFor(viewer);

  return (
    <div className="space-y-5">
      <PageHeader
        title="评测机"
        description="各队列的排队情况与评测机在线状态。"
      />

      {visible.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border bg-surface py-10 text-center text-sm">
          目前没有你可以查看的评测机。
        </p>
      ) : (
        <JudgeStatusBoard
          initial={visible}
          lang={site.lang}
          timezone={site.timezone}
        />
      )}
    </div>
  );
}
