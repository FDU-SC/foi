import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { leaderboardRows } from "@/lib/stats";
import { cn } from "@/lib/utils";

/**
 * 全局排行榜（本部署定制页面）。
 *
 * 按解出题数排序，展示提交次数、AC 数与首杀数；当前用户行高亮。
 */
export async function LeaderboardView() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/leaderboard");
  if (!allows("leaderboard.read", null, viewerFor(user))) notFound();

  const rows = await leaderboardRows();

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-fg text-2xl font-bold tracking-tight">排行榜</h1>
        <span className="text-fg-subtle text-sm">按解出题数排序</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有人提交过——来当第一个吧。
        </p>
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr className="text-fg-muted text-xs">
                <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                  排名
                </th>
                <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                  用户
                </th>
                <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                  解题数
                </th>
                <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                  提交次数
                </th>
                <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                  首杀
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row, index) => {
                const isMe = user.uid === row.uid;
                return (
                  <tr
                    key={row.uid}
                    className={cn("hover:bg-surface-2/60", isMe && "bg-primary/5")}
                  >
                    <td className="text-fg-muted px-4 py-2.5 font-mono text-xs">
                      {index + 1}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-fg font-medium">{row.nickname}</span>
                      <span className="text-fg-subtle ml-1.5 font-mono text-xs">
                        @{row.username}
                      </span>
                      {isMe ? (
                        <span className="text-fg-muted ml-1.5 text-xs">（我）</span>
                      ) : null}
                    </td>
                    <td className="text-fg px-4 py-2.5 text-right font-mono tabular-nums">
                      {row.solved}
                    </td>
                    <td className="text-fg-subtle px-4 py-2.5 text-right font-mono tabular-nums">
                      {row.submissions}
                    </td>
                    <td className="text-fg-subtle px-4 py-2.5 text-right font-mono tabular-nums">
                      {row.firstBloods}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
