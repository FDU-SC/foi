"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  centered,
  clampOffset,
  cropOf,
  scaleFor,
  zoomAround,
  ZOOM,
  type CropState,
} from "./crop";
import { encodeAvatar } from "./encode";

/** The frame is fixed, so every offset in `CropState` is in these pixels. */
const FRAME = 288;

const WHEEL_STEP = 0.12;

export interface AvatarCropperProps {
  /** The picture being cropped. Null keeps the dialog closed. */
  image: ImageBitmap | null;
  onCancel: () => void;
  onCropped: (file: File) => void;
  onFailed: (reason: string) => void;
}

/**
 * A fixed round frame with the picture moving underneath it.
 *
 * `showModal` is what buys the focus trap, the Escape key and the backdrop, so
 * none of that is reimplemented here. The panel is mounted per picture, which
 * is also how pan and zoom reset — no effect has to undo the previous one.
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
      className="border-border bg-surface text-fg m-auto rounded-xl border p-0 shadow-xl backdrop:bg-black/60"
    >
      {image ? (
        <CropPanel
          image={image}
          onCancel={onCancel}
          onCropped={onCropped}
          onFailed={onFailed}
        />
      ) : null}
    </dialog>
  );
}

/**
 * The preview is a canvas rather than a positioned `<img>`, which keeps the
 * decoded picture in one form: the same bitmap feeds the preview and the final
 * encode, and there is no object URL whose lifetime has to be managed.
 */
function paint(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  state: CropState,
): void {
  const ratio = window.devicePixelRatio || 1;

  canvas.width = FRAME * ratio;
  canvas.height = FRAME * ratio;

  const context = canvas.getContext("2d");
  if (!context) return;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, FRAME, FRAME);

  const scale = scaleFor(image, FRAME, state.zoom);
  context.drawImage(
    image,
    state.x,
    state.y,
    image.width * scale,
    image.height * scale,
  );
}

function CropPanel({
  image,
  onCancel,
  onCropped,
  onFailed,
}: AvatarCropperProps & { image: ImageBitmap }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const [state, setState] = useState<CropState>(() => centered(image, FRAME));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (canvas.current) paint(canvas.current, image, state);
  }, [image, state]);

  const nudgeZoom = useCallback(
    (delta: number) => {
      setState((current) => zoomAround(image, FRAME, current, current.zoom + delta));
    },
    [image],
  );

  // React registers wheel listeners passively, so keeping the page from
  // scrolling behind the dialog takes a direct registration.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      nudgeZoom(event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [nudgeZoom]);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    drag.current = { x: event.clientX - state.x, y: event.clientY - state.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const from = drag.current;
    if (!from) return;

    setState((current) =>
      clampOffset(image, FRAME, {
        zoom: current.zoom,
        x: event.clientX - from.x,
        y: event.clientY - from.y,
      }),
    );
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function confirm() {
    setBusy(true);
    try {
      onCropped(await encodeAvatar(image, cropOf(image, FRAME, state)));
    } catch (error) {
      onFailed(
        error instanceof Error ? error.message : "图片处理失败，请换一张试试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-fit space-y-4 p-5">
      <div>
        <h2 className="text-fg text-base font-semibold">调整头像</h2>
        <p className="text-fg-muted mt-1 text-xs leading-5">
          拖动移动位置，滚轮或下方滑块缩放。圆圈里的部分就是最终的头像。
        </p>
      </div>

      <div
        className="bg-surface-3 relative overflow-hidden rounded-lg"
        style={{ width: FRAME, height: FRAME }}
      >
        <canvas
          ref={canvas}
          aria-hidden
          className="touch-none select-none"
          style={{ width: FRAME, height: FRAME, cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {/* A ring of shadow rather than a mask, so the frame stays one element. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
        />
      </div>

      <label className="flex items-center gap-3">
        <span className="text-fg-muted text-xs">缩放</span>
        <input
          type="range"
          min={ZOOM.min}
          max={ZOOM.max}
          step={ZOOM.step}
          value={state.zoom}
          onChange={(event) =>
            setState((current) =>
              zoomAround(image, FRAME, current, Number(event.target.value)),
            )
          }
          className="accent-primary flex-1"
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <Button type="button" variant="primary" onClick={confirm} disabled={busy}>
          {busy ? "处理中…" : "使用这张"}
        </Button>
      </div>
    </div>
  );
}
