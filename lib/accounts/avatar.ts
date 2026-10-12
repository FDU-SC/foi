/**
 * What an avatar is allowed to be, and how an account without one is drawn.
 *
 * The browser re-encodes every upload to WebP through a canvas, so the server
 * accepts exactly one format; `avatar-image.ts` decodes and re-encodes it. That
 * rules out SVG, which can carry script and would be served from this origin.
 *
 * Nothing here touches the image codec, the database or the request, so the
 * same module answers for the upload limits and for drawing an identicon in a
 * client component.
 */

export const AVATAR_LIMITS = {
  /** The square the browser encodes to before uploading. */
  edge: 256,

  /**
   * Kept under `SERVER_ACTION_BODY_LIMIT`. Past that ceiling the request never
   * reaches the action, and the user gets an error boundary instead of a reason.
   */
  maxBytes: 48 * 1024,

  /** Wide enough for a re-encode that overshoots, narrow enough to bound decoding. */
  maxEdge: 512,
} as const;

/** The glyph an identicon shows. Iterated by code point, so emoji stay whole. */
export function identiconInitial(nickname: string): string {
  const [first] = [...nickname.trim()];
  return first ? first.toUpperCase() : "?";
}
