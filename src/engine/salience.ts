import { releaseCanvas } from './decode';
import { computePreviewScale } from './geometry';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';

function clampUnit(n: number): number {
  return Math.max(-1, Math.min(1, Number(n.toFixed(3))));
}

/**
 * Fast 0-ML salience centroid estimator using gradient energy with an upper-third
 * portrait vertical prior. Returns normalized focal coordinates in [-1, 1].
 */
export function estimateSalientFocalPoint(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { focalX: number; focalY: number } {
  if (width < 3 || height < 3 || data.length < width * height * 4) {
    return { focalX: 0, focalY: 0 };
  }

  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    if (data[p + 3]! === 0) {
      luma[i] = -1;
    } else {
      luma[i] = (data[p]! * 54 + data[p + 1]! * 183 + data[p + 2]! * 19) >> 8;
    }
  }

  let sumW = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 1; y < height - 1; y++) {
    const ny = y / (height - 1);
    // Mild vertical bias toward upper third (head/eyes in portraits & screenshots)
    const yPrior = 0.55 + 0.45 * Math.exp(-Math.pow((ny - 0.34) / 0.35, 2));

    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (luma[idx]! < 0) continue;

      const lx = luma[idx - 1]!;
      const rx = luma[idx + 1]!;
      const ty = luma[idx - width]!;
      const by = luma[idx + width]!;
      if (lx < 0 || rx < 0 || ty < 0 || by < 0) continue;

      const energy = Math.abs(rx - lx) + Math.abs(by - ty);
      if (energy < 6) continue;

      const nx = x / (width - 1);
      const xPrior = 0.7 + 0.3 * Math.exp(-Math.pow((nx - 0.5) / 0.45, 2));
      const w = energy * yPrior * xPrior;
      sumW += w;
      sumX += nx * w;
      sumY += ny * w;
    }
  }

  if (sumW <= 1) {
    return { focalX: 0, focalY: 0 };
  }

  const cx = sumX / sumW;
  const cy = sumY / sumW;
  return {
    focalX: clampUnit((cx - 0.5) * 2),
    focalY: clampUnit((cy - 0.5) * 2),
  };
}

/** Downscale bitmap onto a <= 64px scratch canvas and estimate initial focal point. */
export function computeBitmapSalience(
  bitmap: BitmapLike,
  platform: EnginePlatform,
): { focalX: number; focalY: number } {
  const thumb = computePreviewScale({ width: bitmap.width, height: bitmap.height }, 64);
  if (thumb.width < 3 || thumb.height < 3) {
    return { focalX: 0, focalY: 0 };
  }

  let scratch: CanvasLike | null = null;
  try {
    scratch = platform.createCanvas(thumb.width, thumb.height);
    const ctx = scratch.getContext('2d');
    if (!ctx || typeof ctx.getImageData !== 'function') {
      return { focalX: 0, focalY: 0 };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, thumb.width, thumb.height);
    const img = ctx.getImageData(0, 0, thumb.width, thumb.height);
    return estimateSalientFocalPoint(img.data, thumb.width, thumb.height);
  } finally {
    releaseCanvas(scratch);
  }
}
