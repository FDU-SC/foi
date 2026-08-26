/**
 * How this problem draws its own results, found by
 * `content-problem-view-modules.ts`.
 *
 * Both implementations are shared, because what they read is shared: the stock
 * panel posts the payload and the backend behind this problem reports
 * `{ tests, message }`. Naming them here rather than registering one pair for
 * the whole deployment is what lets the next problem answer differently — it
 * exports something else, and nothing has to be told about the exception.
 */
export { PayloadView } from "../_shared/views/submitted";
export { VerdictDetail } from "../_shared/views/tests-table";
