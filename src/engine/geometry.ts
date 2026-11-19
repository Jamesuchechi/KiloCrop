import type { Dimensions, Rect, Spec } from './types';

const MM_PER_INCH = 25.4;

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
