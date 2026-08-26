/**
 * How this problem draws its own results, found by
 * `content-problem-view-modules.ts`.
 *
 * No `VerdictDetail`: an inline judge reports a status and a score and puts
 * nothing in `detail`, so there is nothing here that would draw it better than
 * the kernel's dump. An unfilled slot is the ordinary case, not a gap.
 */
export { PayloadView } from "../_shared/views/submitted";
