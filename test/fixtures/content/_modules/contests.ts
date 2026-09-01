import {
  archived,
  main,
  open,
  sealed,
  staged,
  upcoming,
  upsolve,
} from "../contests";

export const contestModules = {
  "./contests/fixture-main/contest.ts": { contest: main },
  "./contests/fixture-open/contest.ts": { contest: open },
  "./contests/fixture-staged/contest.ts": { contest: staged },
  "./contests/fixture-upcoming/contest.ts": { contest: upcoming },
  "./contests/fixture-archived/contest.ts": { contest: archived },
  "./contests/fixture-upsolve/contest.ts": { contest: upsolve },
  "./contests/fixture-sealed/contest.ts": { contest: sealed },
};
