import { ProfileLink } from "@/components/account/profile-link";
import type { BoardProps } from "@/lib/standings/types";
import { cn } from "@/lib/utils";

function DefaultCell({ cell }: { cell: unknown }) {
  if (cell === undefined || cell === null) return null;
  return <span className="text-fg text-xs">✓</span>;
}

function DefaultTotal({ row }: { row: { total: number } }) {
  return <span className="text-fg font-semibold tabular-nums">{Math.round(row.total)}</span>;
}

/**
 * "Rank | Name | Total | one column per problem", ruled like a printed
 * scoreboard. The viewer's own row is marked through the rank, name and total.
 */
export function ProblemGridBoard({ board, problems, highlight }: BoardProps) {
  const Cell = board.renderers.Cell ?? DefaultCell;
  const Total = board.renderers.Total ?? DefaultTotal;
  const { standings } = board;

  if (standings.rows.length === 0) {
    return (
      <p className="text-fg-muted border-border border-y py-10 text-center text-sm">
        还没有提交记录。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-fg text-fg-muted border-b text-xs">
            <th className="w-12 py-2 pr-3 text-right font-medium">#</th>
            <th className="bg-bg sticky left-0 z-10 min-w-36 py-2 pr-3 text-left font-medium">
              选手
            </th>
            <th className="w-16 py-2 pr-3 text-center font-medium">
              {standings.totalLabel}
            </th>
            {problems.map((problem) => (
              <th
                key={problem.key}
                className="text-fg w-[92px] min-w-[92px] py-2 text-center text-[13px] font-bold"
                title={problem.title}
              >
                {problem.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => {
            const mine = row.participant.uid === highlight;
            return (
              <tr
                key={row.participant.uid}
                aria-current={mine || undefined}
                className="border-border border-b"
              >
                <td className={cn("text-fg-muted py-1 pr-3 text-right text-xs tabular-nums", mine && "bg-mark")}>
                  {row.rank}
                </td>
                <td className={cn("sticky left-0 z-10 py-1 pr-3", mine ? "bg-mark" : "bg-bg")}>
                  <ProfileLink
                    username={row.participant.username}
                    className={cn("text-fg", mine && "font-semibold")}
                  >
                    {row.participant.nickname}
                  </ProfileLink>
                </td>
                <td className={cn("py-1 pr-3 text-center", mine && "bg-mark")}>
                  <Total row={row} />
                </td>
                {problems.map((problem) => (
                  <td key={problem.key} className="p-[3px] text-center">
                    <Cell cell={row.cells[problem.key]} problem={problem} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
