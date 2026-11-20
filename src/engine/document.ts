import { closeBitmap, decodeWorkingBitmap, releaseCanvas, scaleBitmapToCanvas } from './decode';
import { encodeAdaptiveCanvas } from './encode';
import { applySharpen } from './enhance';
import { clampCropRect, computeFitPlan } from './geometry';
import type {
  BitmapLike,
  CanvasLike,
  DocumentCleanOptions,
  DocumentCleanResult,
  DocumentColorMode,
  EnginePlatform,
  InspectReport,
} from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

function isBitmapLike(source: Blob | BitmapLike): source is BitmapLike {
  return typeof (source as BitmapLike).close === 'function';
}

/**
 * Compute a smooth local paper-brightness grid (85th percentile per coarse tile)
 * so uneven camera shadows lift cleanly without blowing out dark ink or stamps.
 */
function estimatePaperIlluminationGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  gridW: number,
  gridH: number,
): Float32Array {
  const numBins = 64;
  const bins = new Uint32Array(gridW * gridH * numBins);
  const cellCounts = new Uint32Array(gridW * gridH);
  const globalBins = new Uint32Array(numBins);
  let globalCount = 0;
  const step = width * height > 600_000 ? 2 : 1;

  for (let y = 0; y < height; y += step) {
    const gy = Math.min(gridH - 1, Math.floor((y * gridH) / height));
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x += step) {
      const i = rowOff + x * 4;
      if (data[i + 3] === 0) continue;
      const luma = (data[i]! * 54 + data[i + 1]! * 183 + data[i + 2]! * 19) >> 8;
      const gx = Math.min(gridW - 1, Math.floor((x * gridW) / width));
      const cellIdx = gy * gridW + gx;
      const bin = luma >> 2;
      bins[cellIdx * numBins + bin] = (bins[cellIdx * numBins + bin] ?? 0) + 1;
      cellCounts[cellIdx] = (cellCounts[cellIdx] ?? 0) + 1;
      globalBins[bin] = (globalBins[bin] ?? 0) + 1;
      globalCount++;
    }
  }

  let globalPaper85 = 240;
  if (globalCount > 0) {
    const target = globalCount * 0.85;
    let acc = 0;
    for (let b = 0; b < numBins; b++) {
      acc += globalBins[b]!;
      if (acc >= target) {
        globalPaper85 = b * 4 + 2;
        break;
      }
    }
  }

  const floorVal = Math.max(72, globalPaper85 * 0.45);
  const rawGrid = new Float32Array(gridW * gridH);
  for (let cellIdx = 0; cellIdx < gridW * gridH; cellIdx++) {
    const cnt = cellCounts[cellIdx]!;
    if (cnt === 0) {
      rawGrid[cellIdx] = globalPaper85;
      continue;
    }
    const target = cnt * 0.85;
    let acc = 0;
    let est = globalPaper85;
    const base = cellIdx * numBins;
    for (let b = 0; b < numBins; b++) {
      acc += bins[base + b]!;
      if (acc >= target) {
        est = b * 4 + 2;
        break;
      }
    }
    rawGrid[cellIdx] = Math.max(floorVal, est);
  }

  // Single 3x3 box-smoothing pass prevents tile seams while preserving edge shadow tracking.
  const smoothed = new Float32Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = clamp(gy + dy, 0, gridH - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const nx = clamp(gx + dx, 0, gridW - 1);
          sum += rawGrid[ny * gridW + nx]!;
          weight++;
        }
      }
      smoothed[gy * gridW + gx] = sum / weight;
    }
  }

  return smoothed;
}

function sampleBilinearGrid(
  grid: Float32Array,
  gridW: number,
  gridH: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const gx = clamp(((x + 0.5) / width) * gridW - 0.5, 0, gridW - 1);
  const gy = clamp(((y + 0.5) / height) * gridH - 0.5, 0, gridH - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(gridW - 1, x0 + 1);
  const y1 = Math.min(gridH - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;

  const v00 = grid[y0 * gridW + x0]!;
  const v10 = grid[y0 * gridW + x1]!;
  const v01 = grid[y1 * gridW + x0]!;
  const v11 = grid[y1 * gridW + x1]!;
  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

export interface DocumentPixelOptions {
  mode: DocumentColorMode;
  levelStrength: number;
  whitenPaper: number;
  sharpenPct: number;
  bwBias?: number;
}

/** Clean uneven illumination, stretch paper white-point, convert color mode, and sharpen text. */
export function cleanDocumentPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: DocumentPixelOptions,
): { leveledApplied: boolean } {
  const pixelCount = width * height;
  if (pixelCount <= 0 || data.length < pixelCount * 4) {
    return { leveledApplied: false };
  }

  const levelMix = clamp(opts.levelStrength / 100, 0, 1);
  const whitenMix = clamp(opts.whitenPaper / 100, 0, 1);
  const leveledApplied = levelMix > 0;

  const gridW = clamp(Math.ceil(width / 32), 8, 36);
  const gridH = clamp(Math.ceil(height / 32), 8, 36);
  const bgGrid = leveledApplied
    ? estimatePaperIlluminationGrid(data, width, height, gridW, gridH)
    : null;

  const whiteClip = 255 - whitenMix * 38;
  const blackClip = whitenMix * 18;
  const stretchRange = Math.max(32, whiteClip - blackClip);
  const stretchScale = 255 / stretchRange;
  const bwThreshold = 182 + clamp(opts.bwBias ?? 0, -40, 40);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3]!;
      if (alpha === 0) continue;

      let r = data[i]!;
      let g = data[i + 1]!;
      let b = data[i + 2]!;

      if (bgGrid) {
        const bg = sampleBilinearGrid(bgGrid, gridW, gridH, x, y, width, height);
        const ratio = clamp(254 / Math.max(48, bg), 1.0, 3.2);
        const effGain = 1 + (ratio - 1) * levelMix;
        r *= effGain;
        g *= effGain;
        b *= effGain;
      }

      if (whitenMix > 0) {
        r = (r - blackClip) * stretchScale;
        g = (g - blackClip) * stretchScale;
        b = (b - blackClip) * stretchScale;
      }

      r = clampByte(r);
      g = clampByte(g);
      b = clampByte(b);

      if (opts.mode === 'grayscale') {
        const yVal = clampByte((r * 54 + g * 183 + b * 19) >> 8);
        data[i] = yVal;
        data[i + 1] = yVal;
        data[i + 2] = yVal;
      } else if (opts.mode === 'bw') {
        const yVal = (r * 54 + g * 183 + b * 19) >> 8;
        const u = clamp((yVal - (bwThreshold - 12)) / 24, 0, 1);
        const smooth = Math.round(u * u * (3 - 2 * u) * 255);
        data[i] = smooth;
        data[i + 1] = smooth;
        data[i + 2] = smooth;
      } else {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }
  }

  if (opts.sharpenPct > 0) {
    applySharpen(data, width, height, opts.sharpenPct);
  }

  return { leveledApplied };
}

/** Apply document shadow leveling, paper whitening, and stroke sharpening onto a CanvasLike. */
export function cleanDocumentCanvas(
  canvas: CanvasLike,
  opts: DocumentPixelOptions,
): { leveledApplied: boolean } {
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') {
    return { leveledApplied: false };
  }
  const { width, height } = canvas;
  if (width <= 0 || height <= 0) {
    return { leveledApplied: false };
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  const res = cleanDocumentPixels(imageData.data, width, height, opts);
  ctx.putImageData(imageData, 0, 0);
  return res;
}

/** Scale, clean shadows/paper, sharpen ink, and compress a scanned document offline. */
export async function runDocumentClean(
  source: Blob | BitmapLike,
  options: DocumentCleanOptions,
  report: InspectReport,
  platform: EnginePlatform,
  signal?: AbortSignal,
): Promise<DocumentCleanResult> {
  checkAborted(signal);
  const ownsBitmap = !isBitmapLike(source);
  const maxEdge = Math.min(
    3600,
    Math.max(2400, options.targetWidth ?? 0, options.targetHeight ?? 0),
  );

  let workingBitmap: BitmapLike | null = null;
  let canvas: CanvasLike | null = null;

  try {
    workingBitmap = ownsBitmap
      ? await decodeWorkingBitmap(source, report.orientedDimensions, maxEdge, platform)
      : source;
    checkAborted(signal);

    const origDims = report.orientedDimensions ?? {
      width: workingBitmap.width,
      height: workingBitmap.height,
    };

    const plan = computeFitPlan(origDims, {
      targetWidth: options.targetWidth,
      targetHeight: options.targetHeight,
      fit: 'inside',
      dontEnlarge: true,
    });

    const scaleX = workingBitmap.width / origDims.width;
    const scaleY = workingBitmap.height / origDims.height;
    const mappedRect = clampCropRect(
      {
        x: plan.sourceRect.x * scaleX,
        y: plan.sourceRect.y * scaleY,
        width: plan.sourceRect.width * scaleX,
        height: plan.sourceRect.height * scaleY,
      },
      { width: workingBitmap.width, height: workingBitmap.height },
    );

    canvas = scaleBitmapToCanvas(workingBitmap, mappedRect, plan.outputDims, platform);
    checkAborted(signal);

    const { leveledApplied } = cleanDocumentCanvas(canvas, {
      mode: options.mode,
      levelStrength: options.levelStrength,
      whitenPaper: options.whitenPaper,
      sharpenPct: options.sharpenPct,
      bwBias: options.bwBias,
    });

    checkAborted(signal);

    const encoded = await encodeAdaptiveCanvas(
      canvas,
      {
        format: options.format,
        quality: options.quality,
        minKb: null,
        maxKb: options.maxKb,
        dpi: null,
        allowShrinkToFitKb: true,
        signal,
      },
      platform,
    );

    return {
      blob: encoded.blob,
      bytes: encoded.bytes,
      width: encoded.width,
      height: encoded.height,
      originalWidth: origDims.width,
      originalHeight: origDims.height,
      requestedFormat: encoded.requestedFormat,
      actualFormat: encoded.actualFormat,
      actualMime: encoded.actualMime,
      quality: encoded.quality,
      status: encoded.status,
      shrunkToFitKb: encoded.shrunkToFitKb,
      leveledApplied,
      wasClampedToSafeArea: plan.wasClampedToSafeArea,
    };
  } finally {
    releaseCanvas(canvas);
    if (ownsBitmap) {
      closeBitmap(workingBitmap);
    }
  }
}
