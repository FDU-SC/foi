import { and, eq, not, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { accounts, submissions } from "@/lib/db/schema";
import { ACTIONS, type QueryableActionId } from "./actions";
import { policiesFor } from "./registry";
import type { ResourceKind } from "./resources";
import type { CompiledPolicy, PrincipalMatcher } from "./types";
import type { Viewer } from "./viewer";

/**
 * The same policies, asked about a whole table instead of one row.
 *
 * A list endpoint cannot afford to evaluate every row, so queryable actions
 * answer in SQL: permits are OR-ed into the visible set, forbids are subtracted
 * from it. The registry refuses to start if a policy knows how to answer one
 * form and not the other.
 */

export type RowScope =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "where"; sql: SQL };

const OWNER_COLUMN = {
  submission: submissions.uid,
  account: accounts.uid,
} as const satisfies Partial<Record<ResourceKind, PgColumn>>;

/** Unrestricted, impossible, or a concrete condition. */
type Condition = "all" | "none" | SQL;

/** What a policy contributes: unrestricted, a condition, or nothing at all. */
type Contribution = "all" | SQL | null;

function ownerColumn(action: QueryableActionId): PgColumn | undefined {
  const kind: ResourceKind = ACTIONS[action].resource;
  return kind in OWNER_COLUMN
    ? OWNER_COLUMN[kind as keyof typeof OWNER_COLUMN]
    : undefined;
}

/**
 * The part of a principal matcher that depends only on who is asking. `self`
 * has no viewer-only answer beyond "is anybody asking" — which rows it selects
 * is decided in `principalRows`.
 */
function principalApplies(
  matcher: PrincipalMatcher | undefined,
  viewer: Viewer,
): boolean {
  if (!matcher) return true;
  if ("group" in matcher) return viewer.groups.includes(matcher.group);
  if ("anyGroup" in matcher) {
    return matcher.anyGroup.some((group) => viewer.groups.includes(group));
  }
  if ("authenticated" in matcher) return viewer.authenticated;
  return viewer.uid !== null;
}

function principalRows(
  matcher: PrincipalMatcher | undefined,
  viewer: Viewer,
  action: QueryableActionId,
): Condition {
  if (!matcher || !("self" in matcher)) return "all";

  const column = ownerColumn(action);
  if (!column || viewer.uid === null) return "none";
  return eq(column, viewer.uid);
}

function conditionOf(
  entry: CompiledPolicy,
  action: QueryableActionId,
  viewer: Viewer,
  now: Date,
): Contribution {
  if (!principalApplies(entry.principal, viewer)) return null;

  const parts: SQL[] = [];

  const rows = principalRows(entry.principal, viewer, action);
  if (rows === "none") return null;
  if (rows !== "all") parts.push(rows);

  if (entry.filter) {
    const clause = entry.filter({ viewer, now });
    if (clause) parts.push(clause);
  }

  if (parts.length === 0) return "all";
  return and(...parts) ?? "all";
}

/** Whether any row at all could come back — cheaper than running the query. */
export function canQueryAny(
  action: QueryableActionId,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return rowScope(action, viewer, now).kind !== "none";
}

/**
 * Note for `forbid` filters: the clause is negated, and SQL's three-valued
 * logic drops rows where it evaluates to NULL. Compare nullable columns with
 * that in mind, or the forbid will hide more than it means to.
 */
export function rowScope(
  action: QueryableActionId,
  viewer: Viewer,
  now = new Date(),
): RowScope {
  let permitsEverything = false;
  const permitted: SQL[] = [];
  const excluded: SQL[] = [];

  for (const entry of policiesFor(action)) {
    const condition = conditionOf(entry, action, viewer, now);
    if (condition === null) continue;

    if (entry.effect === "forbid") {
      // An unconditional forbid removes the table outright.
      if (condition === "all") return { kind: "none" };
      excluded.push(condition);
      continue;
    }

    if (condition === "all") permitsEverything = true;
    else permitted.push(condition);
  }

  if (!permitsEverything && permitted.length === 0) return { kind: "none" };

  const clauses: SQL[] = [];

  if (!permitsEverything) {
    const visible = or(...permitted);
    if (visible) clauses.push(visible);
  }

  for (const clause of excluded) clauses.push(not(clause));

  const combined = and(...clauses);
  return combined ? { kind: "where", sql: combined } : { kind: "all" };
}
