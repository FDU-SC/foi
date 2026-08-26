import type { ContestStandings } from "@/lib/standings/compute";

function DefaultCell({ cell }: { cell: unknown }) {
  if (cell === undefined || cell === null) {
    return <span className="text-fg-subtle">·</span>;
  }
  const score = (cell as { score?: number }).score;
  return (
    <span className="text-fg font-mono text-xs tabular-nums">
      {typeof score === "number" ? Math.round(score) : "✓"}
    </span>
  );
}

function DefaultTotal({ row }: { row: { total: number } }) {
  return (
    <span className="text-fg font-mono font-semibold tabular-nums">
      {Math.round(row.total)}
    </span>
  );
}

/**
 * Renders whatever the contest's ruleset produced.
 *
 * The kernel lays out rows, ranks and problem columns; how a single cell reads
 * is entirely the ruleset's business, which is why `render.Cell` is called
 * here rather than switched on a format enum.
 */
export function StandingsTable({ data }: { data: ContestStandings }) {
  const { standings, problems, ruleset } = data;
  const Cell = ruleset.render?.Cell ?? DefaultCell;
  const Total = ruleset.render?.Total ?? DefaultTotal;

  if (standings.rows.length === 0) {
    return (
      <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
        还没有提交记录。
      </p>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2">
          <tr className="text-fg-muted text-xs">
            <th className="border-border w-12 border-b px-3 py-2.5 text-right font-semibold">
              #
            </th>
            <th className="border-border border-b px-3 py-2.5 text-left font-semibold">
              选手
            </th>
            <th className="border-border w-20 border-b px-3 py-2.5 text-center font-semibold">
              {standings.totalLabel}
            </th>
            {problems.map((problem) => (
              <th
                key={problem.slug}
                className="border-border border-b px-2 py-2.5 text-center font-semibold"
                title={problem.title}
              >
                {problem.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {standings.rows.map((row) => (
            <tr key={row.participant.handle} className="hover:bg-surface-2/60">
              <td className="text-fg-muted px-3 py-2 text-right font-mono text-xs tabular-nums">
                {row.rank}
              </td>
              <td className="px-3 py-2">
                <span className="text-fg font-medium">
                  {row.participant.displayName}
                </span>
                <span className="text-fg-subtle ml-2 font-mono text-xs">
                  {row.participant.handle}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                <Total row={row} />
              </td>
              {problems.map((problem) => (
                <td key={problem.slug} className="px-2 py-2 text-center">
                  <Cell cell={row.cells[problem.slug]} problem={problem} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
