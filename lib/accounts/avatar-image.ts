import "server-only";
import sharp from "sharp";
import { AVATAR_LIMITS } from "./avatar";

export type AvatarImage =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

const UNSUPPORTED = "图片格式不受支持，请重新选择。";

/**
 * The upload decoded in full and encoded again, so the bytes served back from
 * this origin are ones this server produced: no metadata, first frame only.
 */
export async function normalizeAvatar(bytes: Uint8Array): Promise<AvatarImage> {
  if (bytes.byteLength === 0) return { ok: false, error: "请选择一张图片。" };

  if (bytes.byteLength > AVATAR_LIMITS.maxBytes) {
    const kb = Math.floor(AVATAR_LIMITS.maxBytes / 1024);
    return { ok: false, error: `图片过大，请控制在 ${kb} KB 以内。` };
  }

  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: AVATAR_LIMITS.maxEdge ** 2,
    });

    const { format, width, height } = await image.metadata();
    if (format !== "webp" || !width || !height) return { ok: false, error: UNSUPPORTED };

    if (width > AVATAR_LIMITS.maxEdge || height > AVATAR_LIMITS.maxEdge) {
      return {
        ok: false,
        error: `图片尺寸过大，边长不能超过 ${AVATAR_LIMITS.maxEdge} 像素。`,
      };
    }

    return { ok: true, bytes: new Uint8Array(await image.webp({ quality: 90 }).toBuffer()) };
  } catch {
    return { ok: false, error: UNSUPPORTED };
  }
}
