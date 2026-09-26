import type { ComponentType } from "react";
import { Avatar } from "@/components/ui/avatar";
import { MotionTr } from "@/components/ui/motion";
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
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有提交记录。
        </p>
      );
    }

    return (
      <div className="oj-table-frame">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr className="text-fg-muted text-xs">
              <th className="border-border w-14 border-b px-3 py-2.5 text-right font-semibold">#</th>
              <th className="border-border border-b px-3 py-2.5 text-left font-semibold">用户</th>
              <th className="border-border border-b px-3 py-2.5 text-right font-semibold">
                {standings.totalLabel}
              </th>
              {columns.map((column) => (
                <th key={column.label} className="border-border border-b px-3 py-2.5 text-right font-semibold">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {(standings.rows as StandingsRow<Cell>[]).map((row) => {
              const mine = row.participant.uid === highlight;
              return (
                <MotionTr
                  key={row.participant.uid}
                  aria-current={mine || undefined}
                  className={cn("hover:bg-surface-2/60", mine && "bg-primary/5")}
                >
                  <td className="text-fg-muted px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                    {row.rank}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar of={row.participant} />
                      <span className="text-fg font-medium">{row.participant.nickname}</span>
                      {row.participant.username ? (
                        <span className="text-fg-subtle font-mono text-xs">@{row.participant.username}</span>
                      ) : null}
                      {mine ? <span className="text-fg-muted text-xs">（我）</span> : null}
                    </div>
                  </td>
                  <td className="text-fg px-3 py-2.5 text-right font-mono tabular-nums">
                    {Total ? <Total row={row} /> : Math.round(row.total)}
                  </td>
                  {columns.map((column) => (
                    <td key={column.label} className="text-fg-subtle px-3 py-2.5 text-right font-mono tabular-nums">
                      {column.value(row)}
                    </td>
                  ))}
                </MotionTr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };
}
