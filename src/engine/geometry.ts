import type { Dimensions, FitMode, FitOptions, FitPlan, Rect, Spec } from './types';

const MM_PER_INCH = 25.4;

export const MAX_RESIZE_EDGE = 8000;
export const MAX_SAFE_CANVAS_AREA = 16_000_000;

/** Convert millimetres to whole pixels at the given DPI. */
export function mmToPx(mm: number, dpi: number): number {
  if (!Number.isFinite(mm) || !Number.isFinite(dpi) || mm <= 0 || dpi <= 0) {
    throw new RangeError(`Invalid mm (${mm}) or dpi (${dpi})`);
  }
  return Math.max(1, Math.round((mm / MM_PER_INCH) * dpi));
}

/** Convert pixels to millimetres at the given DPI. */
export function pxToMm(px: number, dpi: number): number {
  if (!Number.isFinite(px) || !Number.isFinite(dpi) || px <= 0 || dpi <= 0) {
    throw new RangeError(`Invalid px (${px}) or dpi (${dpi})`);
  }
  return (px / dpi) * MM_PER_INCH;
}

/** Resolve integer pixel dimensions and effective DPI for a Spec. */
export function resolveOutputDimensions(spec: Spec): Dimensions & { dpi: number | null } {
  if (spec.output.units === 'mm') {
    const dpi = spec.output.dpi ?? 300;
    return {
      width: mmToPx(spec.output.width, dpi),
      height: mmToPx(spec.output.height, dpi),
      dpi,
    };
  }
  return {
    width: Math.max(1, Math.round(spec.output.width)),
    height: Math.max(1, Math.round(spec.output.height)),
    dpi: spec.output.dpi,
  };
}

/** Return dimensions after applying EXIF orientation (orientations 5-8 swap width/height). */
export function orientedDimensions(dims: Dimensions, orientation: number): Dimensions {
  if (orientation >= 5 && orientation <= 8) {
    return { width: dims.height, height: dims.width };
  }
  return { width: dims.width, height: dims.height };
}

/** Compute the largest centered crop inside source bounds matching targetAspect (width/height). */
export function computeCenteredCrop(source: Dimensions, targetAspect: number): Rect {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    !Number.isFinite(targetAspect) ||
    source.width <= 0 ||
    source.height <= 0 ||
    targetAspect <= 0
  ) {
    throw new RangeError('Source dimensions and targetAspect must be positive finite numbers');
  }

  const srcAspect = source.width / source.height;
  if (srcAspect >= targetAspect) {
    const height = source.height;
    const width = Math.min(source.width, height * targetAspect);
    return {
      x: (source.width - width) / 2,
      y: 0,
      width,
      height,
    };
  }

  const width = source.width;
  const height = Math.min(source.height, width / targetAspect);
  return {
    x: 0,
    y: (source.height - height) / 2,
    width,
    height,
  };
}

/** Clamp a crop rectangle strictly within source bounds [0, bounds.width] x [0, bounds.height]. */
export function clampCropRect(rect: Rect, bounds: Dimensions): Rect {
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new RangeError('Bounds must have positive dimensions');
  }
  const width = Math.max(1, Math.min(bounds.width, rect.width));
  const height = Math.max(1, Math.min(bounds.height, rect.height));
  const x = Math.max(0, Math.min(bounds.width - width, rect.x));
  const y = Math.max(0, Math.min(bounds.height - height, rect.y));
  return { x, y, width, height };
}

/** Compute capped working preview dimensions that never upscale and keep long edge <= maxLongEdge. */
export function computePreviewScale(source: Dimensions, maxLongEdge = 1600): Dimensions {
  if (source.width <= 0 || source.height <= 0 || maxLongEdge <= 0) {
    throw new RangeError('Dimensions and maxLongEdge must be positive');
  }
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= maxLongEdge) {
    return { width: Math.round(source.width), height: Math.round(source.height) };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

function sanitizeEdge(val: number | null): number | null {
  if (val === null || !Number.isFinite(val) || val <= 0) return null;
  return Math.max(1, Math.min(MAX_RESIZE_EDGE, Math.round(val)));
}

function clampUnitSigned(val: number | undefined): number {
  if (val === undefined || !Number.isFinite(val)) return 0;
  return Math.max(-1, Math.min(1, val));
}

/**
 * Compute source crop rect, destination rect, and output pixel dimensions for
 * inside / fill / pad / stretch modes, enforcing no-upscale and the 16 MP safe ceiling.
 */
export function computeFitPlan(source: Dimensions, options: FitOptions): FitPlan {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new RangeError('Source dimensions must be positive finite numbers');
  }

  const W = sanitizeEdge(options.targetWidth);
  const H = sanitizeEdge(options.targetHeight);
  const effectiveFit: FitMode = options.fit !== 'inside' && !(W && H) ? 'inside' : options.fit;

  let sourceRect: Rect = { x: 0, y: 0, width: source.width, height: source.height };
  let dw: number;
  let dh: number;
  let cropped = false;

  if (effectiveFit === 'inside') {
    let s = Math.min(W ? W / source.width : Infinity, H ? H / source.height : Infinity);
    if (!Number.isFinite(s)) s = 1;
    if (options.dontEnlarge) s = Math.min(s, 1);
    dw = Math.max(1, Math.round(source.width * s));
    dh = Math.max(1, Math.round(source.height * s));
  } else if (effectiveFit === 'fill') {
    const s = Math.max(W! / source.width, H! / source.height);
    const sw = Math.min(source.width, W! / s);
    const sh = Math.min(source.height, H! / s);
    const maxX = Math.max(0, source.width - sw);
    const maxY = Math.max(0, source.height - sh);
    const fx = clampUnitSigned(options.focalX);
    const fy = clampUnitSigned(options.focalY);
    const sx = maxX * ((fx + 1) / 2);
    const sy = maxY * ((fy + 1) / 2);
    sourceRect = { x: sx, y: sy, width: sw, height: sh };
    dw = W!;
    dh = H!;
    cropped = maxX > 0.5 || maxY > 0.5;
  } else {
    dw = W!;
    dh = H!;
  }

  let wasClampedToSafeArea = false;
  if (dw * dh > MAX_SAFE_CANVAS_AREA) {
    const safeScale = Math.sqrt(MAX_SAFE_CANVAS_AREA / (dw * dh));
    dw = Math.max(1, Math.floor(dw * safeScale));
    dh = Math.max(1, Math.floor(dh * safeScale));
    wasClampedToSafeArea = true;
  }

  let destRect: Rect;
  if (effectiveFit === 'pad') {
    let fgScale = Math.min(dw / source.width, dh / source.height);
    if (options.dontEnlarge) {
      fgScale = Math.min(fgScale, 1);
    }
    const fw = Math.max(1, Math.min(dw, Math.round(source.width * fgScale)));
    const fh = Math.max(1, Math.min(dh, Math.round(source.height * fgScale)));
    destRect = {
      x: Math.floor((dw - fw) / 2),
      y: Math.floor((dh - fh) / 2),
      width: fw,
      height: fh,
    };
  } else {
    destRect = { x: 0, y: 0, width: dw, height: dh };
  }

  return {
    sourceRect,
    destRect,
    outputDims: { width: dw, height: dh },
    effectiveFit,
    wasClampedToSafeArea,
    cropped,
  };
}
