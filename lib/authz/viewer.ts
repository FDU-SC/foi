/**
 * The principal of an authorization request.
 *
 * A viewer carries identity only — never permissions. What a viewer may do is
 * answered by evaluating policies against it, never by reading a field off it.
 *
 * Suspended accounts never reach this type: `getResolvedUser` refuses them, so
 * they arrive as `ANONYMOUS`. Suspension of a *target* account is a different
 * question and is expressed as policy on the account resource.
 */
export interface Viewer {
  readonly uid: number | null;

  /** Group ids resolved from `content/enrollment/`, recomputed each request. */
  readonly groups: readonly string[];

  readonly authenticated: boolean;
}

export const ANONYMOUS: Viewer = {
  uid: null,
  groups: [],
  authenticated: false,
};

export function viewerFor(
  user: { uid: number; groups: readonly string[] } | null | undefined,
): Viewer {
  if (!user) return ANONYMOUS;
  return { uid: user.uid, groups: user.groups, authenticated: true };
}

/** What the session hands to the UI. Not an authorization input. */
export interface SessionUser {
  uid: number;
  username: string;
  nickname: string;
  avatarUpdatedAt: Date | null;
  groups: string[];
}
