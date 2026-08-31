"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import {
  removeAvatarAction,
  updateAvatarAction,
  type SettingsState,
} from "@/app/(site)/settings/actions";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Avatar, type AvatarSubject } from "@/components/ui/avatar";
import { Field } from "@/components/ui/field";
import { AVATAR_LIMITS } from "@/lib/accounts/avatar";
import { cn } from "@/lib/utils";

/** Large enough to cover a phone photo, small enough not to stall decoding. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** Comfortably under what the action accepts, so a re-encode never overshoots. */
const TARGET_BYTES = 32 * 1024;

const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

/**
 * Tried in order when quality alone cannot get under the target. Dense pixel
 * art costs roughly 32KB at 256px even at the lowest quality, and shrinking is
 * what keeps such an image from becoming an upload the user cannot complete.
 */
const EDGES = [AVATAR_LIMITS.edge, 192, 128];

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

/** The centre square of the source, drawn at `edge` pixels. */
function squareCanvas(bitmap: ImageBitmap, edge: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。");

  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    edge,
    edge,
  );

  return canvas;
}

/**
 * Centre-crop to a square and encode as WebP, giving up detail until it fits.
 *
 * Doing this in the browser is what keeps the upload inside the Server Action
 * body limit and lets the server accept exactly one format.
 */
async function toAvatarFile(source: File): Promise<File> {
  if (!source.type.startsWith("image/")) {
    throw new Error("请选择图片文件。");
  }
  if (source.size > MAX_SOURCE_BYTES) {
    throw new Error("原图过大，请先压缩后再上传。");
  }

  const bitmap = await createImageBitmap(source);

  try {
    for (const edge of EDGES) {
      const canvas = squareCanvas(bitmap, edge);

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
  } finally {
    bitmap.close();
  }

  throw new Error("这张图压缩后仍然过大，换一张试试。");
}

/**
 * One result for two actions. They stay separate on the server — each has its
 * own gate and its own budget — but a single state is what stops "已更新" and
 * "已移除" from sitting on screen contradicting each other.
 */
function submitAvatar(
  prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return formData.get("intent") === "remove"
    ? removeAvatarAction(prev, formData)
    : updateAvatarAction(prev, formData);
}

export function AvatarForm({ current }: { current: AvatarSubject }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    submitAvatar,
    {},
  );

  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  function showPreview(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setPreview(objectUrl.current);
  }

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const picked = input.files?.[0];
    if (!picked) return;

    setProblem(null);
    setBusy(true);

    try {
      const encoded = await toAvatarFile(picked);

      // Submitting the original would blow the body limit, so the input has to
      // carry the re-encoded file by the time the form goes out.
      const transfer = new DataTransfer();
      transfer.items.add(encoded);
      input.files = transfer.files;

      showPreview(encoded);
    } catch (error) {
      input.value = "";
      showPreview(null);
      setProblem(
        error instanceof Error ? error.message : "图片处理失败，请换一张试试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-5">
        {preview ? (
          <img
            src={preview}
            alt=""
            aria-hidden
            className="size-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Avatar of={current} size="lg" />
        )}

        <form action={formAction} className="min-w-0 flex-1 space-y-3">
          <Field
            label="上传新头像"
            hint={`会自动裁成 ${AVATAR_LIMITS.edge}×${AVATAR_LIMITS.edge} 的方形，转成 WebP 后上传。`}
          >
            <input
              type="file"
              name="avatar"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPick}
              disabled={busy}
              className={cn(
                "text-fg-muted block w-full text-sm",
                "file:border-border file:bg-surface-2 file:text-fg file:mr-3",
                "file:cursor-pointer file:rounded-md file:border file:px-3 file:py-1.5",
                "file:text-sm file:font-medium hover:file:bg-surface-3",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
          </Field>

          <PendingSubmit
            variant="primary"
            pendingLabel="上传中…"
            disabled={busy || !preview}
          >
            保存头像
          </PendingSubmit>
        </form>
      </div>

      {current.avatarUpdatedAt ? (
        <form action={formAction}>
          <input type="hidden" name="intent" value="remove" />
          <PendingSubmit size="sm" pendingLabel="移除中…">
            移除当前头像
          </PendingSubmit>
        </form>
      ) : null}

      {problem ? <FormMessage tone="err">{problem}</FormMessage> : null}
      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      {state.message ? <FormMessage tone="ok">{state.message}</FormMessage> : null}
    </div>
  );
}
