import { clampCropRect, computePreviewScale, orientedDimensions } from './geometry';
import type { BitmapLike, CanvasLike, Dimensions, EnginePlatform, Rect } from './types';

export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_SAFE_CANVAS_PIXELS = 16_000_000;
export const PREVIEW_MAX_LONG_EDGE = 1600;
export const INTERMEDIATE_MAX_LONG_EDGE = 3200;

export interface ExtractOptions {
  useCropAtDecode?: boolean;
}

/** Safely close an ImageBitmap-compatible handle if present. */
export function closeBitmap(bmp: BitmapLike | null | undefined): void {
  if (!bmp) return;
  try {
    bmp.close();
  } catch {
    // Ignore double-close or already-detached handles.
  }
}

/** Shrink canvas backing store immediately to free GPU/tab memory (critical on iOS Safari). */
export function releaseCanvas(canvas: CanvasLike | null | undefined): void {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

/** Reject empty or oversized inputs before decoding to prevent decompression bombs. */
export function assertInputSafe(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new RangeError('Input file is empty.');
  }
  if (bytes > MAX_INPUT_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    throw new RangeError(`Input file (${mb} MB) exceeds the 50 MB safety limit.`);
  }
}

/**
 * Decode an oriented working preview capped at 1600 px on the long edge
 * so 48 MP phone shots stay well under mobile browser memory limits.
 */
export async function decodePreview(
  blob: Blob,
  rawDims: Dimensions | null,
  orientation: number,
  platform: EnginePlatform,
): Promise<BitmapLike> {
  assertInputSafe(blob.size);

  if (rawDims && rawDims.width > 0 && rawDims.height > 0) {
    const oriented = orientedDimensions(rawDims, orientation);
    const target = computePreviewScale(oriented, PREVIEW_MAX_LONG_EDGE);
    return platform.createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: target.width,
      resizeHeight: target.height,
    });
  }

  return platform.createImageBitmap(blob, {
    imageOrientation: 'from-image',
    resizeWidth: PREVIEW_MAX_LONG_EDGE,
  });
}

/**
 * Extract the user's crop rectangle into an exact output-sized canvas.
 * Defaults to a capped intermediate decode (<= 3200 px long edge) unless
 * `useCropAtDecode` is enabled after real-device validation.
 */
export async function extractCroppedCanvas(
  blob: Blob,
  cropRect: Rect,
  orientedDims: Dimensions | null,
  outputDims: Dimensions,
  platform: EnginePlatform,
  options: ExtractOptions = {},
): Promise<CanvasLike> {
  assertInputSafe(blob.size);

  const outW = Math.max(1, Math.round(outputDims.width));
  const outH = Math.max(1, Math.round(outputDims.height));
  if (outW * outH > MAX_SAFE_CANVAS_PIXELS) {
    throw new RangeError(`Requested output (${outW}×${outH}) exceeds the 16 MP safe canvas limit.`);
  }

  const canvas = platform.createCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    releaseCanvas(canvas);
    throw new Error('Could not acquire 2D canvas context.');
  }

  let bmp: BitmapLike | null = null;
  try {
    if (options.useCropAtDecode && platform.createCroppedImageBitmap && orientedDims) {
      const clamped = clampCropRect(cropRect, orientedDims);
      const sx = Math.max(0, Math.round(clamped.x));
      const sy = Math.max(0, Math.round(clamped.y));
      const sw = Math.max(1, Math.min(orientedDims.width - sx, Math.round(clamped.width)));
      const sh = Math.max(1, Math.min(orientedDims.height - sy, Math.round(clamped.height)));

      bmp = await platform.createCroppedImageBitmap(blob, sx, sy, sw, sh, {
        imageOrientation: 'from-image',
        resizeWidth: outW,
        resizeHeight: outH,
      });
      ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, outW, outH);
      return canvas;
    }

    if (orientedDims && orientedDims.width > 0 && orientedDims.height > 0) {
      const target = computePreviewScale(orientedDims, INTERMEDIATE_MAX_LONG_EDGE);
      bmp = await platform.createImageBitmap(blob, {
        imageOrientation: 'from-image',
        resizeWidth: target.width,
        resizeHeight: target.height,
      });

      const scaleX = bmp.width / orientedDims.width;
      const scaleY = bmp.height / orientedDims.height;
      const mapped = clampCropRect(
        {
          x: cropRect.x * scaleX,
          y: cropRect.y * scaleY,
          width: cropRect.width * scaleX,
          height: cropRect.height * scaleY,
        },
        { width: bmp.width, height: bmp.height },
      );

      ctx.drawImage(bmp, mapped.x, mapped.y, mapped.width, mapped.height, 0, 0, outW, outH);
      return canvas;
    }

    bmp = await platform.createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: INTERMEDIATE_MAX_LONG_EDGE,
    });
    const clamped = clampCropRect(cropRect, { width: bmp.width, height: bmp.height });
    ctx.drawImage(bmp, clamped.x, clamped.y, clamped.width, clamped.height, 0, 0, outW, outH);
    return canvas;
  } catch (err) {
    releaseCanvas(canvas);
    throw err;
  } finally {
    closeBitmap(bmp);
  }
}
