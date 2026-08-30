import {
  assignRanks,
  hasResult,
  submissionsInWindow,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
} from "@/lib/standings/types";

export interface TallyCell {
  solved: boolean;
  /** Submissions that came back with a verdict, the accepted one included. */
  attempts: number;
  /** Submissions whose result the viewer is not allowed to see yet. */
  pending: number;
  minutes: number;
}

/**
 * Counts solved problems, breaks ties on elapsed minutes.
 *
 * Deliberately implements the freeze contract: a masked result (`result: null`)
 * counts as pending rather than as a wrong answer, which is what makes a frozen
 * board a subset of the real one instead of a different one.
 */
export const tally: Ruleset<TallyCell> = {
  id: "fixture-tally",
  name: "通过数",
  description: "按通过题数排名，同数按用时排序。",

  compute(input: StandingsInput) {
    const start = input.contest.startsAt.getTime();
    const scored = submissionsInWindow(input);

    const rows: Omit<StandingsRow<TallyCell>, "rank">[] = input.participants.map(
      (participant) => {
        const cells: Record<string, TallyCell> = {};
        let total = 0;
        let tiebreak = 0;

        for (const problem of input.problems) {
          const cell: TallyCell = {
            solved: false,
            attempts: 0,
            pending: 0,
            minutes: 0,
          };

          for (const submission of scored) {
            if (cell.solved) break;
            if (
              submission.uid !== participant.uid ||
              submission.problemSlug !== problem.slug
            ) {
              continue;
            }

            if (!hasResult(submission)) {
              cell.pending += 1;
              continue;
            }

            cell.attempts += 1;
            const result = submission.result as { accepted?: boolean };
            if (result.accepted === true) {
              cell.solved = true;
              cell.minutes = Math.floor(
                (submission.createdAt.getTime() - start) / 60_000,
              );
            }
          }

          cells[problem.slug] = cell;
          if (cell.solved) {
            total += 1;
            tiebreak += cell.minutes;
          }
        }

        return { participant, total, tiebreak, cells };
      },
    );

    return { rows: assignRanks(rows), totalLabel: "通过" };
  },
};
