import { ACTIONS, denialFor, type ActionId, type ResourceOf } from "./actions";
import { policiesFor } from "./registry";
import { OWNER_OF, type ResourceKind } from "./resources";
import type {
  CompiledPolicy,
  Decision,
  EvalInputFor,
  PrincipalMatcher,
} from "./types";
import type { Viewer } from "./viewer";

export interface AuthorizeContext {
  now?: Date;

  /** Which interactive action on a problem is being invoked. */
  invocation?: string | null;
}

/** Who a resource belongs to, or null when the kind has no owner. */
function ownerOf(action: ActionId, resource: unknown): number | null {
  const kind: ResourceKind = ACTIONS[action].resource;
  const read = OWNER_OF[kind] as ((resource: unknown) => number) | undefined;
  if (!read || resource === null || resource === undefined) return null;
  return read(resource);
}

function matchesPrincipal(
  matcher: PrincipalMatcher | undefined,
  viewer: Viewer,
  action: ActionId,
  resource: unknown,
): boolean {
  if (!matcher) return true;
  if ("group" in matcher) return viewer.groups.includes(matcher.group);
  if ("anyGroup" in matcher) {
    return matcher.anyGroup.some((group) => viewer.groups.includes(group));
  }
  if ("authenticated" in matcher) return viewer.authenticated;
  return viewer.uid !== null && ownerOf(action, resource) === viewer.uid;
}

function applies(
  candidate: CompiledPolicy,
  input: EvalInputFor<ActionId>,
): boolean {
  if (
    !matchesPrincipal(
      candidate.principal,
      input.viewer,
      input.action,
      input.resource,
    )
  ) {
    return false;
  }

  return candidate.when ? candidate.when(input) : true;
}

/**
 * Default-deny: a request is refused unless some policy permits it. A matching
 * `forbid` wins over every `permit`, which is what makes the platform's own
 * invariants — no submitting outside a contest's collecting window, no
 * competing in a contest you are not entered in — impossible for content to
 * grant around.
 *
 * Takes its candidates as an argument so the rule can be exercised against a
 * hand-written policy set rather than the deployment's own.
 */
export function evaluate(
  candidates: readonly CompiledPolicy[],
  action: ActionId,
  resource: unknown,
  viewer: Viewer,
  context: AuthorizeContext = {},
): Decision {
  const input = {
    viewer,
    action,
    resource,
    now: context.now ?? new Date(),
    invocation: context.invocation ?? null,
  } as EvalInputFor<ActionId>;

  for (const candidate of candidates) {
    if (candidate.effect !== "forbid") continue;
    if (!applies(candidate, input)) continue;
    return {
      allow: false,
      via: candidate.id,
      reason: candidate.reason ?? denialFor(action),
    };
  }

  for (const candidate of candidates) {
    if (candidate.effect !== "permit") continue;
    if (!applies(candidate, input)) continue;
    return { allow: true, via: candidate.id };
  }

  return { allow: false, via: null, reason: denialFor(action) };
}

/** The one question the platform asks about permission. */
export function authorize<A extends ActionId>(
  action: A,
  resource: ResourceOf<A>,
  viewer: Viewer,
  context?: AuthorizeContext,
): Decision {
  return evaluate(policiesFor(action), action, resource, viewer, context);
}

export function allows<A extends ActionId>(
  action: A,
  resource: ResourceOf<A>,
  viewer: Viewer,
  context?: AuthorizeContext,
): boolean {
  return authorize(action, resource, viewer, context).allow;
}
