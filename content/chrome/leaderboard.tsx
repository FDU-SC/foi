import Link from "next/link";
import { catalogueLeaderboards, leaderboardHref } from "@/lib/contests/catalogue";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { leaderboardRows } from "./leaderboard-data";
import { cn } from "@/lib/utils";

/**
 * 练习排行榜。
 *
 * 按总分与达成时间排序，展示提交次数和首杀数。
 */
export async function FoiLeaderboard({ board }: { board?: string }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(leaderboardHref(board))}`);
  if (!allows("leaderboard.read", null, viewerFor(user))) notFound();

  const boards = catalogueLeaderboards();
  const selected = boards.find((item) => item.id === board);
  if (board !== undefined && !selected) notFound();
  const title = selected ? `${selected.title}排行榜` : "总排行榜";
  const rows = await leaderboardRows(50, new Date(), board);

  return (
    <div className="space-y-5">
      <h1 className="text-fg text-2xl font-bold tracking-tight">{title}</h1>

      <nav aria-label="排行榜" className="flex flex-wrap gap-3 text-sm">
        {[{ id: undefined, title: "总榜" }, ...boards].map((item) => (
          <Link key={item.id ?? "total"} href={leaderboardHref(item.id)} aria-current={item.id === board ? "page" : undefined} className={cn("rounded-md px-3 py-2", item.id === board ? "bg-primary text-white" : "bg-surface-2 hover:text-primary")}>
            {item.title}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border bg-surface py-10 text-center text-sm">
          还没有提交记录。
        </p>
      ) : (
        <div className="oj-table-frame">
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
                  总分
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
              {rows.map((row) => {
                const isMe = user.uid === row.uid;
                return (
                  <tr
                    key={row.uid}
                    className={cn(
                      "hover:bg-surface-2/60",
                      isMe && "bg-primary/5",
                    )}
                  >
                    <td className="text-fg-muted px-4 py-2.5 font-mono text-xs">
                      {row.rank}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-fg font-medium">
                        {row.nickname}
                      </span>
                      <span className="text-fg-subtle ml-1.5 font-mono text-xs">
                        @{row.username}
                      </span>
                      {isMe ? (
                        <span className="text-fg-muted ml-1.5 text-xs">
                          （我）
                        </span>
                      ) : null}
                    </td>
                    <td className="text-fg px-4 py-2.5 text-right font-mono tabular-nums">
                      {Number(row.total.toFixed(2))}
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
