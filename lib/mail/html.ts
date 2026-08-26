/**
 * The characters that must not be able to close a tag or an attribute.
 *
 * Here rather than in either template file because both of them need it and a
 * second copy is how one of them ends up fixed and the other not. Mail bodies
 * are assembled as strings — there is no framework escaping anything on the
 * way out — so every interpolation of a name, a URL or a code goes through
 * this.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
