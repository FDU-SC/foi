/**
 * What an avatar is allowed to be, and how to read one.
 *
 * The browser re-encodes every upload through a canvas, so the server accepts
 * exactly one format and validates it by hand. That rules out SVG, which can
 * carry script and would be served from this origin.
 *
 * Nothing here touches the database or the request, so the same module answers
 * for the upload gate and for drawing an identicon in a client component.
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

export interface WebpSize {
  width: number;
  height: number;
}

/** RIFF header plus the first chunk's header. */
const HEADER_BYTES = 20;

/** Where the first chunk's payload starts. */
const PAYLOAD = HEADER_BYTES;

function fourCC(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

function uint24(view: DataView, at: number): number {
  return (
    view.getUint8(at) |
    (view.getUint8(at + 1) << 8) |
    (view.getUint8(at + 2) << 16)
  );
}

/** Simple lossy: a 3-byte frame tag, the key frame start code, then the size. */
function lossy(view: DataView, chunkSize: number): WebpSize | null {
  if (chunkSize < 10) return null;

  if (
    view.getUint8(PAYLOAD + 3) !== 0x9d ||
    view.getUint8(PAYLOAD + 4) !== 0x01 ||
    view.getUint8(PAYLOAD + 5) !== 0x2a
  ) {
    return null;
  }

  return {
    width: view.getUint16(PAYLOAD + 6, true) & 0x3fff,
    height: view.getUint16(PAYLOAD + 8, true) & 0x3fff,
  };
}

/** Lossless: a signature byte, then 14 bits of width-1 and 14 of height-1. */
function lossless(view: DataView, chunkSize: number): WebpSize | null {
  if (chunkSize < 5) return null;
  if (view.getUint8(PAYLOAD) !== 0x2f) return null;

  const bits = view.getUint32(PAYLOAD + 1, true);

  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
  };
}

/** Extended: flags and reserved bytes, then the canvas size as two uint24. */
function extended(view: DataView, chunkSize: number): WebpSize | null {
  if (chunkSize < 10) return null;

  return {
    width: uint24(view, PAYLOAD + 4) + 1,
    height: uint24(view, PAYLOAD + 7) + 1,
  };
}

/** The declared dimensions, or null when this is not a WebP this can read. */
export function parseWebp(bytes: Uint8Array): WebpSize | null {
  if (bytes.byteLength < HEADER_BYTES) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (fourCC(view, 0) !== "RIFF" || fourCC(view, 8) !== "WEBP") return null;

  // Both lengths are declared by the file itself, so a short buffer is a
  // truncated upload rather than a shape this can reason about.
  if (view.getUint32(4, true) + 8 > bytes.byteLength) return null;

  const chunkSize = view.getUint32(16, true);
  if (PAYLOAD + chunkSize > bytes.byteLength) return null;

  switch (fourCC(view, 12)) {
    case "VP8 ":
      return lossy(view, chunkSize);
    case "VP8L":
      return lossless(view, chunkSize);
    case "VP8X":
      return extended(view, chunkSize);
    default:
      return null;
  }
}

/** Why these bytes cannot become an avatar, or null when they can. */
export function avatarRejection(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return "请选择一张图片。";

  if (bytes.byteLength > AVATAR_LIMITS.maxBytes) {
    const kb = Math.floor(AVATAR_LIMITS.maxBytes / 1024);
    return `图片过大，请控制在 ${kb} KB 以内。`;
  }

  const size = parseWebp(bytes);
  if (!size) return "图片格式不受支持，请重新选择。";

  if (size.width < 1 || size.height < 1) {
    return "图片格式不受支持，请重新选择。";
  }

  if (size.width > AVATAR_LIMITS.maxEdge || size.height > AVATAR_LIMITS.maxEdge) {
    return `图片尺寸过大，边长不能超过 ${AVATAR_LIMITS.maxEdge} 像素。`;
  }

  return null;
}

/**
 * The hue an account's identicon uses, keyed on uid so it survives a rename.
 * FNV-1a: short, and stable across runtimes in a way `hashCode` folklore is not.
 */
export function identiconHue(uid: number): number {
  let hash = 0x811c9dc5;

  for (const char of String(uid)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0) % 360;
}

/** The glyph an identicon shows. Iterated by code point, so emoji stay whole. */
export function identiconInitial(nickname: string): string {
  const [first] = [...nickname.trim()];
  return first ? first.toUpperCase() : "?";
}
