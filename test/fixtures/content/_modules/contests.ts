import { main, staged } from "../contests";

export const contestModules = {
  "./contests/fixture-main/contest.ts": { contest: main },
  "./contests/fixture-staged/contest.ts": { contest: staged },
};
