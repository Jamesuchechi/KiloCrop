import type { CanvasLike, EnhanceOptions } from './types';

/**
 * Gently expand narrow dynamic range across opaque pixels using a 0.5% luma tail clip.
 * Skips flat, already well-contrasted, or fully transparent inputs.
 */
export function applyAutoContrast(data: Uint8ClampedArray, width: number, height: number): boolean {
  const pixelCount = width * height;
  if (pixelCount <= 0 || data.length < pixelCount * 4) return false;

  const hist = new Uint32Array(256);
  let opaqueCount = 0;

  for (let i = 0; i < pixelCount * 4; i += 4) {
    if (data[i + 3] === 0) continue;
    const luma = (data[i]! * 54 + data[i + 1]! * 183 + data[i + 2]! * 19) >> 8;
    hist[luma] = (hist[luma] ?? 0) + 1;
    opaqueCount++;
  }

  if (opaqueCount === 0) return false;

  const tail = opaqueCount * 0.005;
  let lo = 0;
  let acc = 0;
  while (lo < 255 && (acc += hist[lo]!) < tail) {
    lo++;
  }

  let hi = 255;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]!) < tail) {
    hi--;
  }

  if (hi - lo <= 40 || (lo <= 6 && hi >= 249)) {
    return false;
  }

  const k = 255 / (hi - lo);
  for (let i = 0; i < pixelCount * 4; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = (data[i]! - lo) * k;
    data[i + 1] = (data[i + 1]! - lo) * k;
    data[i + 2] = (data[i + 2]! - lo) * k;
  }

  return true;
}

/**
 * Unsharp-style 4-neighbor Laplacian sharpen pass scaled by tighten percent [0, 100].
 * Skips transparent edges so PNG cutouts do not pick up dark halos.
 */
export function applySharpen(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sharpenPct: number,
): boolean {
  if (!Number.isFinite(sharpenPct) || sharpenPct <= 0 || width < 3 || height < 3) {
    return false;
  }
  const pct = Math.max(0, Math.min(100, sharpenPct));
  if (pct <= 0) return false;

  const expectedLen = width * height * 4;
  if (data.length < expectedLen) return false;

  const src = new Uint8ClampedArray(data.subarray(0, expectedLen));
  const a = (pct / 100) * 0.6;
  const stride = width * 4;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * stride + x * 4;
      if (
        src[i + 3] === 0 ||
        src[i - 4 + 3] === 0 ||
        src[i + 4 + 3] === 0 ||
        src[i - stride + 3] === 0 ||
        src[i + stride + 3] === 0
      ) {
        continue;
      }

      for (let c = 0; c < 3; c++) {
        const j = i + c;
        const center = src[j]!;
        data[j] =
          center +
          a * (4 * center - src[j - 4]! - src[j + 4]! - src[j - stride]! - src[j + stride]!);
      }
    }
  }

  return true;
}

/** Apply optional auto-contrast and post-scale sharpening directly on a CanvasLike. */
export function enhanceCanvas(
  canvas: CanvasLike,
  options: EnhanceOptions,
): { contrastApplied: boolean; sharpenApplied: boolean } {
  if (!options.autoContrast && options.sharpenPct <= 0) {
    return { contrastApplied: false, sharpenApplied: false };
  }

  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') {
    return { contrastApplied: false, sharpenApplied: false };
  }

  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) {
    return { contrastApplied: false, sharpenApplied: false };
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const contrastApplied = options.autoContrast
    ? applyAutoContrast(imageData.data, width, height)
    : false;
  const sharpenApplied =
    options.sharpenPct > 0
      ? applySharpen(imageData.data, width, height, options.sharpenPct)
      : false;

  if (contrastApplied || sharpenApplied) {
    ctx.putImageData(imageData, 0, 0);
  }

  return { contrastApplied, sharpenApplied };
}
