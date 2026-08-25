import {
  assignRanks,
  isAccepted,
  scoredSubmissions,
  type Ruleset,
  type StandingsInput,
} from "@/lib/standings/types";

interface PlainCell {
  solved: boolean;
  attempts: number;
}

/**
 * Count the problems solved, break ties on attempts. That is the whole format.
 *
 * Deliberately plain: what the skeleton has to prove is that the kernel knows
 * nothing beyond the `Ruleset` interface, and a format with penalty minutes or
 * dynamic scoring would prove it less clearly by being interesting.
 *
 * `supportsFreeze` is true because the kernel needs one format that implements
 * the window — the freeze suite runs over every format that claims it, and
 * with none the whole mechanism goes untested. The implementation is the
 * minimum the contract asks for: past `freezeAt`, stop counting.
 */
export const ruleset: Ruleset<PlainCell> = {
  id: "plain",
  name: "简易赛制",
  description: "按解题数排名，同分比提交次数。",
  supportsFreeze: true,

  computeStandings(input: StandingsInput) {
    const freezeAt = input.contest.freezeAt?.getTime();
    const now = Date.now();
    const frozen =
      freezeAt !== undefined &&
      now >= freezeAt &&
      now <= input.contest.endsAt.getTime();

    const cells = new Map<string, Map<string, PlainCell>>();
    for (const participant of input.participants) {
      cells.set(participant.handle, new Map());
    }

    for (const submission of scoredSubmissions(input)) {
      // Withholding results past the cutoff is the whole of what freezing
      // means here. A richer format would draw the cell as pending instead.
      if (frozen && submission.createdAt.getTime() >= freezeAt) continue;

      const row = cells.get(submission.handle);
      if (!row) continue;

      const cell = row.get(submission.problemSlug) ?? {
        solved: false,
        attempts: 0,
      };
      row.set(submission.problemSlug, cell);
      cell.attempts += 1;
      if (isAccepted(submission)) cell.solved = true;
    }

    const rows = input.participants.map((participant) => {
      const row = cells.get(participant.handle) ?? new Map<string, PlainCell>();
      const solved = [...row.values()].filter((cell) => cell.solved).length;
      const attempts = [...row.values()].reduce(
        (sum, cell) => sum + cell.attempts,
        0,
      );
      return {
        participant,
        total: solved,
        tiebreak: attempts,
        cells: Object.fromEntries(row),
      };
    });

    return {
      rows: assignRanks(rows),
      totalLabel: "解题数",
      frozen,
    };
  },

  render: {
    Cell: ({ cell }: { cell: PlainCell | undefined }) =>
      cell ? <span>{cell.solved ? "✓" : `${cell.attempts}`}</span> : null,
  },
};
