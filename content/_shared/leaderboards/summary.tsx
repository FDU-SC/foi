import type { ComponentType } from "react";
import { ProfileLink } from "@/components/account/profile-link";
import type { BoardProps, StandingsRow } from "@/lib/standings/types";
import { cn } from "@/lib/utils";

export interface SummaryColumn<Cell> {
  label: string;
  value: (row: StandingsRow<Cell>) => number;
}

/**
 * A "Rank | Name | Total | …" table: one number per column instead of one
 * column per problem, for boards that span more problems than fit across.
 */
export function summaryBoard<Cell>(
  columns: SummaryColumn<Cell>[],
): ComponentType<BoardProps> {
  return function SummaryBoard({ board, highlight }: BoardProps) {
    const { standings } = board;
    const Total = board.renderers.Total;

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
              <th className="py-2 pr-3 text-left font-medium">选手</th>
              <th className="py-2 pr-3 text-right font-medium">{standings.totalLabel}</th>
              {columns.map((column) => (
                <th key={column.label} className="py-2 pr-2 text-right font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(standings.rows as StandingsRow<Cell>[]).map((row) => {
              const mine = row.participant.uid === highlight;
              return (
                <tr
                  key={row.participant.uid}
                  aria-current={mine || undefined}
                  className={cn("border-border border-b", mine && "bg-mark")}
                >
                  <td className="text-fg-muted py-2 pr-3 text-right text-xs tabular-nums">
                    {row.rank}
                  </td>
                  <td className="py-2 pr-3">
                    <ProfileLink
                      username={row.participant.username}
                      className={cn("text-fg", mine && "font-semibold")}
                    >
                      {row.participant.nickname}
                    </ProfileLink>
                    {row.participant.username ? (
                      <span className="text-fg-subtle ml-2 text-xs">@{row.participant.username}</span>
                    ) : null}
                    {mine ? <span className="text-fg-muted text-xs">（我）</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                    {Total ? <Total row={row} /> : Math.round(row.total)}
                  </td>
                  {columns.map((column) => (
                    <td key={column.label} className="text-fg-muted py-2 pr-2 text-right tabular-nums">
                      {column.value(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };
}
