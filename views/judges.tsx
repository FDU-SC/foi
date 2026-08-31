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
      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">评测机</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          队列在 {site.name} 这边，评测机自己来领活。所以下面的排队位置是精确的，不是评测机上报的快照；「在线」指最近一分钟内来领过活的评测机进程数——队列很深但没有评测机在线，和队列很深但大家都在忙，是两回事。
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          目前没有你可以查看的评测机。
        </p>
      ) : (
        <JudgeStatusBoard initial={visible} lang={site.lang} timezone={site.timezone} />
      )}
    </div>
  );
}
