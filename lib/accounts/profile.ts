/** Where someone's profile lives. */
export function profileHref(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}
