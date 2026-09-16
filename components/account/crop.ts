/**
 * Where the crop frame sits over a source image.
 *
 * The frame is fixed and square; the picture moves underneath it. That is the
 * cheaper half of the two usual croppers — no resize handles, no aspect ratio
 * to police — and it is the one that suits a round avatar, because the output
 * is whatever the frame currently shows.
 *
 * Pure arithmetic, so the awkward cases are settled by tests rather than by
 * dragging things around in a browser.
 */

export interface Size {
  width: number;
  height: number;
}

/** The square of the source the frame is showing, in source pixels. */
export interface CropRect {
  x: number;
  y: number;
  size: number;
}

export interface CropState {
  /** Multiplier over the scale that just covers the frame. 1 is fully out. */
  zoom: number;

  /** Top-left of the scaled picture relative to the frame, in frame pixels. */
  x: number;
  y: number;
}

export const ZOOM = { min: 1, max: 4, step: 0.01 } as const;

/** The scale at which the shorter side exactly fills the frame. */
export function coverScale(source: Size, frame: number): number {
  return Math.max(frame / source.width, frame / source.height);
}

export function scaleFor(source: Size, frame: number, zoom: number): number {
  return coverScale(source, frame) * zoom;
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, zoom));
}

/**
 * Offsets that would expose a gap get pulled back. Zoom never drops below the
 * covering scale, so there is always a valid position to fall back to.
 */
export function clampOffset(
  source: Size,
  frame: number,
  state: CropState,
): CropState {
  const scale = scaleFor(source, frame, state.zoom);

  const left = frame - source.width * scale;
  const top = frame - source.height * scale;

  return {
    zoom: state.zoom,
    x: Math.min(0, Math.max(left, state.x)),
    y: Math.min(0, Math.max(top, state.y)),
  };
}

/** The state that shows the middle of the picture at the given zoom. */
export function centered(
  source: Size,
  frame: number,
  zoom: number = ZOOM.min,
): CropState {
  const scale = scaleFor(source, frame, zoom);

  return clampOffset(source, frame, {
    zoom,
    x: (frame - source.width * scale) / 2,
    y: (frame - source.height * scale) / 2,
  });
}

/** Re-zoom without the picture sliding: the frame's centre keeps its subject. */
export function zoomAround(
  source: Size,
  frame: number,
  state: CropState,
  zoom: number,
): CropState {
  const next = clampZoom(zoom);

  const before = scaleFor(source, frame, state.zoom);
  const after = scaleFor(source, frame, next);

  const middle = frame / 2;
  const focusX = (middle - state.x) / before;
  const focusY = (middle - state.y) / before;

  return clampOffset(source, frame, {
    zoom: next,
    x: middle - focusX * after,
    y: middle - focusY * after,
  });
}

/** The source-pixel square behind the frame. */
export function cropOf(
  source: Size,
  frame: number,
  state: CropState,
): CropRect {
  const scale = scaleFor(source, frame, state.zoom);

  return {
    x: -state.x / scale,
    y: -state.y / scale,
    size: frame / scale,
  };
}
