import { MAX_SAFE_CANVAS_PIXELS, releaseCanvas, scaleBitmapToCanvas } from './decode';
import { computeCenteredCrop, computePreviewScale } from './geometry';
import type {
  BitmapLike,
  CanvasLike,
  Dimensions,
  EnginePlatform,
  PadBackdropStyle,
  Rect,
} from './types';

/** Average opaque border pixels around a small scratch buffer to sample backdrop color. */
export function sampleEdgeColor(data: Uint8ClampedArray, width: number, height: number): string {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return '#111827';
  }
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && x !== width - 1 && y !== 0 && y !== height - 1) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3]! === 0) continue;
      rSum += data[i]!;
      gSum += data[i + 1]!;
      bSum += data[i + 2]!;
      count++;
    }
  }

  if (count === 0) return '#111827';
  const r = Math.round(rSum / count);
  const g = Math.round(gSum / count);
  const b = Math.round(bSum / count);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Pure-TS 3x3 separable box blur for tiny (<= 48px) backdrop scratch buffers. */
export function boxBlurRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 2,
): void {
  const expected = width * height * 4;
  if (width < 2 || height < 2 || data.length < expected || passes <= 0) return;

  const tmp = new Uint8ClampedArray(expected);
  const rowStride = width * 4;

  for (let p = 0; p < passes; p++) {
    // Horizontal pass: data -> tmp
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const xl = Math.max(0, x - 1);
        const xr = Math.min(width - 1, x + 1);
        const io = y * rowStride + x * 4;
        const il = y * rowStride + xl * 4;
        const ir = y * rowStride + xr * 4;
        for (let c = 0; c < 4; c++) {
          tmp[io + c] = Math.round((data[il + c]! + data[io + c]! + data[ir + c]!) / 3);
        }
      }
    }
    // Vertical pass: tmp -> data
    for (let y = 0; y < height; y++) {
      const yt = Math.max(0, y - 1);
      const yb = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const io = y * rowStride + x * 4;
        const it = yt * rowStride + x * 4;
        const ib = yb * rowStride + x * 4;
        for (let c = 0; c < 4; c++) {
          data[io + c] = Math.round((tmp[it + c]! + tmp[io + c]! + tmp[ib + c]!) / 3);
        }
      }
    }
  }
}

/**
 * Render an aspect-mismatched image centered inside outputDims using a matching backdrop
 * ('blur' echo, sampled 'edge' color, 'white', or 'dark') without cropping or stretching.
 */
export function renderPaddedBackdrop(
  bitmap: BitmapLike,
  sourceRect: Rect,
  destRect: Rect,
  outputDims: Dimensions,
  style: PadBackdropStyle,
  platform: EnginePlatform,
): CanvasLike {
  const dw = Math.max(1, Math.round(outputDims.width));
  const dh = Math.max(1, Math.round(outputDims.height));
  if (dw * dh > MAX_SAFE_CANVAS_PIXELS) {
    throw new RangeError(`Requested output (${dw}×${dh}) exceeds the 16 MP safe canvas limit.`);
  }

  const outCanvas = platform.createCanvas(dw, dh);
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    releaseCanvas(outCanvas);
    throw new Error('Could not acquire 2D canvas context.');
  }
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';

  let scratch: CanvasLike | null = null;
  let fgCanvas: CanvasLike | null = null;

  try {
    if (style === 'white' || style === 'dark') {
      outCtx.fillStyle = style === 'white' ? '#ffffff' : '#111827';
      outCtx.fillRect(0, 0, dw, dh);
    } else if (style === 'edge') {
      scratch = platform.createCanvas(32, 32);
      const sCtx = scratch.getContext('2d');
      let fill = '#111827';
      if (sCtx) {
        sCtx.drawImage(
          bitmap,
          sourceRect.x,
          sourceRect.y,
          sourceRect.width,
          sourceRect.height,
          0,
          0,
          32,
          32,
        );
        if (typeof sCtx.getImageData === 'function') {
          const img = sCtx.getImageData(0, 0, 32, 32);
          fill = sampleEdgeColor(img.data, 32, 32);
        }
      }
      outCtx.fillStyle = fill;
      outCtx.fillRect(0, 0, dw, dh);
    } else {
      // Frosted blur echo without CSS/Canvas ctx.filter for iOS/worker reliability
      const tiny = computePreviewScale({ width: dw, height: dh }, 48);
      scratch = platform.createCanvas(tiny.width, tiny.height);
      const sCtx = scratch.getContext('2d');
      outCtx.fillStyle = '#111827';
      outCtx.fillRect(0, 0, dw, dh);
      if (sCtx) {
        sCtx.imageSmoothingEnabled = true;
        sCtx.imageSmoothingQuality = 'high';
        const coverRect = computeCenteredCrop(
          { width: bitmap.width, height: bitmap.height },
          dw / dh,
        );
        sCtx.drawImage(
          bitmap,
          coverRect.x,
          coverRect.y,
          coverRect.width,
          coverRect.height,
          0,
          0,
          tiny.width,
          tiny.height,
        );
        if (typeof sCtx.getImageData === 'function' && typeof sCtx.putImageData === 'function') {
          const img = sCtx.getImageData(0, 0, tiny.width, tiny.height);
          boxBlurRgba(img.data, tiny.width, tiny.height, 2);
          sCtx.putImageData(img, 0, 0);
        }
        outCtx.drawImage(scratch, 0, 0, tiny.width, tiny.height, 0, 0, dw, dh);
        outCtx.fillStyle = 'rgba(17, 24, 39, 0.14)';
        outCtx.fillRect(0, 0, dw, dh);
      }
    }

    fgCanvas = scaleBitmapToCanvas(
      bitmap,
      sourceRect,
      { width: destRect.width, height: destRect.height },
      platform,
    );
    outCtx.drawImage(
      fgCanvas,
      0,
      0,
      fgCanvas.width,
      fgCanvas.height,
      destRect.x,
      destRect.y,
      destRect.width,
      destRect.height,
    );

    return outCanvas;
  } catch (err) {
    releaseCanvas(outCanvas);
    throw err;
  } finally {
    releaseCanvas(scratch);
    releaseCanvas(fgCanvas);
  }
}
