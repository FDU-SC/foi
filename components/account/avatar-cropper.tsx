"use client";

import { useEffect, useRef, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { encodeAvatar } from "./encode";

const FRAME = 288;

const ZOOM = { min: 1, max: 4, step: 0.01 } as const;

/** One picked file in the two forms the dialog needs. */
export interface PickedImage {
  /** Decoded once, for the final encode. */
  bitmap: ImageBitmap;

  /** Object URL the cropper displays. */
  url: string;
}

export interface AvatarCropperProps {
  /** The picture being cropped. Null keeps the dialog closed. */
  image: PickedImage | null;
  onCancel: () => void;
  onCropped: (file: File) => void;
  onFailed: (reason: string) => void;
}

/**
 * Fixed round crop frame. `showModal` supplies focus trapping, Escape handling
 * and the backdrop. Mounting per image resets pan and zoom.
 */
export function AvatarCropper({
  image,
  onCancel,
  onCropped,
  onFailed,
}: AvatarCropperProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (image && !element.open) element.showModal();
    if (!image && element.open) element.close();
  }, [image]);

  return (
    <dialog
      ref={dialog}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialog.current) onCancel();
      }}
      className="border-border bg-surface text-fg m-auto rounded-lg border p-0 shadow-xl backdrop:bg-black/60"
    >
      {image ? (
        <CropPanel
          key={image.url}
          image={image}
          onCancel={onCancel}
          onCropped={onCropped}
          onFailed={onFailed}
        />
      ) : null}
    </dialog>
  );
}

function CropPanel({
  image,
  onCancel,
  onCropped,
  onFailed,
}: AvatarCropperProps & { image: PickedImage }) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(ZOOM.min);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!area) return;
    setBusy(true);
    try {
      onCropped(
        await encodeAvatar(image.bitmap, {
          x: area.x,
          y: area.y,
          size: Math.min(area.width, area.height),
        }),
      );
    } catch (error) {
      onFailed(error instanceof Error ? error.message : "图片处理失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-fit space-y-4 p-5">
      <h2 className="text-fg text-base font-semibold">调整头像</h2>

      <div
        className="bg-surface-3 relative overflow-hidden rounded-lg"
        style={{ width: FRAME, height: FRAME }}
      >
        <Cropper
          image={image.url}
          crop={crop}
          zoom={zoom}
          aspect={1}
          minZoom={ZOOM.min}
          maxZoom={ZOOM.max}
          cropShape="round"
          objectFit="cover"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
          cropperProps={{ "aria-label": "头像取景框" }}
        />
      </div>

      <label className="flex items-center gap-3">
        <span className="text-fg-muted text-xs">缩放</span>
        <input
          type="range"
          min={ZOOM.min}
          max={ZOOM.max}
          step={ZOOM.step}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="accent-primary flex-1"
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={confirm}
          disabled={!area}
          pending={busy}
        >
          {busy ? "处理中…" : "保存头像"}
        </Button>
      </div>
    </div>
  );
}
