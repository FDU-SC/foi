import { AVATAR_LIMITS } from "@/lib/accounts/avatar";
import type { CropRect } from "./crop";

/** Large enough to cover a phone photo, small enough not to stall decoding. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** Comfortably under what the action accepts, so a re-encode never overshoots. */
const TARGET_BYTES = 32 * 1024;

const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

/**
 * Tried in order when quality alone cannot get under the target. Dense pixel
 * art costs roughly 32KB at 256px even at the lowest quality, and shrinking is
 * what keeps such an image from becoming an upload nobody can complete.
 */
const EDGES = [AVATAR_LIMITS.edge, 192, 128];

export const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/** Why this file cannot be cropped at all, or null when it can. */
export function sourceRejection(file: File): string | null {
  if (!file.type.startsWith("image/")) return "请选择图片文件。";
  if (file.size > MAX_SOURCE_BYTES) return "原图过大，请先压缩后再上传。";
  return null;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function draw(
  source: CanvasImageSource,
  crop: CropRect,
  edge: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。");

  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    edge,
    edge,
  );

  return canvas;
}

/**
 * The chosen square as WebP, giving up detail until it fits.
 *
 * Encoding in the browser is what keeps the upload inside the Server Action
 * body limit and lets the server accept exactly one format.
 */
export async function encodeAvatar(
  source: CanvasImageSource,
  crop: CropRect,
): Promise<File> {
  for (const edge of EDGES) {
    const canvas = draw(source, crop, edge);

    for (const quality of QUALITIES) {
      const blob = await encode(canvas, quality);
      if (!blob) throw new Error("图片处理失败，请换一张试试。");

      // A canvas that cannot encode WebP silently hands back PNG instead.
      if (blob.type !== "image/webp") {
        throw new Error("当前浏览器不支持 WebP，无法上传头像。");
      }

      if (blob.size <= TARGET_BYTES) {
        return new File([blob], "avatar.webp", { type: "image/webp" });
      }
    }
  }

  throw new Error("这张图压缩后仍然过大，换一张试试。");
}
