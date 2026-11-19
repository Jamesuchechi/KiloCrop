import { padJpegWithCom, setJpegDpi, setPngDpi } from './dpi';
import type { CanvasLike, EncodeResult, EncodeStatus, OutputFormat } from './types';

export type QualityEncoder = (quality: number, format: OutputFormat) => Promise<Uint8Array>;

export interface EncodeWindowOptions {
  width: number;
  height: number;
  format: OutputFormat;
  minKb: number | null;
  maxKb: number | null;
  dpi: number | null;
  qualityFloor?: number;
  maxIterations?: number;
  signal?: AbortSignal;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

function applyDpi(bytes: Uint8Array, format: OutputFormat, dpi: number | null): Uint8Array {
  if (!dpi || dpi <= 0) return bytes;
  return format === 'png' ? setPngDpi(bytes, dpi) : setJpegDpi(bytes, dpi);
}

/** Encode a CanvasLike (OffscreenCanvas or HTMLCanvasElement) to raw bytes. */
export async function canvasToBytes(
  canvas: CanvasLike,
  format: OutputFormat,
  quality: number,
): Promise<Uint8Array> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  let blob: Blob;
  if (typeof canvas.convertToBlob === 'function') {
    blob = await canvas.convertToBlob(format === 'png' ? { type: mime } : { type: mime, quality });
  } else if (typeof canvas.toBlob === 'function') {
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob!(
        (out) => (out ? resolve(out) : reject(new Error('canvas.toBlob returned null'))),
        mime,
        format === 'png' ? undefined : quality,
      );
    });
  } else {
    throw new Error('Canvas supports neither convertToBlob nor toBlob');
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Deterministic binary-search encoder targeting [minKb, maxKb] with DPI injection
 * counted inside the byte budget and harmless COM padding fallback for minKb.
 */
export async function encodeToSizeWindow(
  encodeAtQuality: QualityEncoder,
  options: EncodeWindowOptions,
): Promise<EncodeResult> {
  const {
    width,
    height,
    format,
    minKb,
    maxKb,
    dpi,
    qualityFloor = 0.35,
    maxIterations = 7,
    signal,
  } = options;

  const minBytes = minKb !== null && minKb > 0 ? Math.round(minKb * 1024) : null;
  const maxBytes = maxKb !== null && maxKb > 0 ? Math.round(maxKb * 1024) : null;
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';

  if (format === 'png') {
    checkAborted(signal);
    const bytes = applyDpi(await encodeAtQuality(1, 'png'), 'png', dpi);
    let status: EncodeStatus = 'ok';
    if (maxBytes !== null && bytes.length > maxBytes) status = 'infeasible-max';
    else if (minBytes !== null && bytes.length < minBytes) status = 'below-min';
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: mime }),
      bytes: bytes.length,
      width,
      height,
      dpi,
      quality: 1,
      iterations: 1,
      status,
      paddedBytes: 0,
    };
  }

  // Unbounded case: encode once at high quality
  if (minBytes === null && maxBytes === null) {
    checkAborted(signal);
    const bytes = applyDpi(await encodeAtQuality(0.92, 'jpeg'), 'jpeg', dpi);
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: mime }),
      bytes: bytes.length,
      width,
      height,
      dpi,
      quality: 0.92,
      iterations: 1,
      status: 'ok',
      paddedBytes: 0,
    };
  }

  let iterations = 0;
  let best: { bytes: Uint8Array; quality: number } | null = null;
  let smallestOver: { bytes: Uint8Array; quality: number } | null = null;

  if (maxBytes !== null) {
    let lo = qualityFloor;
    let hi = 0.95;

    while (iterations < maxIterations && hi - lo > 0.01) {
      checkAborted(signal);
      const q = (lo + hi) / 2;
      const bytes = applyDpi(await encodeAtQuality(q, 'jpeg'), 'jpeg', dpi);
      iterations++;

      if (bytes.length <= maxBytes) {
        if (!best || q > best.quality) {
          best = { bytes, quality: q };
        }
        lo = q;
      } else {
        if (!smallestOver || bytes.length < smallestOver.bytes.length) {
          smallestOver = { bytes, quality: q };
        }
        hi = q;
      }
    }

    if (!best) {
      checkAborted(signal);
      const floorBytes = applyDpi(await encodeAtQuality(qualityFloor, 'jpeg'), 'jpeg', dpi);
      iterations++;
      if (floorBytes.length <= maxBytes) {
        best = { bytes: floorBytes, quality: qualityFloor };
      } else {
        const chosen =
          smallestOver && smallestOver.bytes.length < floorBytes.length
            ? smallestOver
            : { bytes: floorBytes, quality: qualityFloor };
        return {
          blob: new Blob([new Uint8Array(chosen.bytes)], { type: mime }),
          bytes: chosen.bytes.length,
          width,
          height,
          dpi,
          quality: chosen.quality,
          iterations,
          status: 'infeasible-max',
          paddedBytes: 0,
        };
      }
    }
  } else {
    checkAborted(signal);
    const bytes = applyDpi(await encodeAtQuality(0.92, 'jpeg'), 'jpeg', dpi);
    iterations = 1;
    best = { bytes, quality: 0.92 };
  }

  // Handle minimum KB requirement if set
  if (minBytes !== null && best.bytes.length < minBytes) {
    checkAborted(signal);
    const maxQBytes = applyDpi(await encodeAtQuality(1.0, 'jpeg'), 'jpeg', dpi);
    iterations++;
    if (
      maxQBytes.length > best.bytes.length &&
      (maxBytes === null || maxQBytes.length <= maxBytes)
    ) {
      best = { bytes: maxQBytes, quality: 1.0 };
    }

    if (best.bytes.length < minBytes) {
      const target = Math.max(minBytes, best.bytes.length + 4);
      if (maxBytes === null || target <= maxBytes) {
        const padded = padJpegWithCom(best.bytes, target);
        const added = padded.length - best.bytes.length;
        if (padded.length >= minBytes && (maxBytes === null || padded.length <= maxBytes)) {
          return {
            blob: new Blob([new Uint8Array(padded)], { type: mime }),
            bytes: padded.length,
            width,
            height,
            dpi,
            quality: best.quality,
            iterations,
            status: 'padded-min',
            paddedBytes: added,
          };
        }
      }

      return {
        blob: new Blob([new Uint8Array(best.bytes)], { type: mime }),
        bytes: best.bytes.length,
        width,
        height,
        dpi,
        quality: best.quality,
        iterations,
        status: 'below-min',
        paddedBytes: 0,
      };
    }
  }

  return {
    blob: new Blob([new Uint8Array(best.bytes)], { type: mime }),
    bytes: best.bytes.length,
    width,
    height,
    dpi,
    quality: best.quality,
    iterations,
    status: 'ok',
    paddedBytes: 0,
  };
}

/** Convenience wrapper encoding a CanvasLike directly with size-window search. */
export async function encodeCanvasToWindow(
  canvas: CanvasLike,
  options: EncodeWindowOptions,
): Promise<EncodeResult> {
  return encodeToSizeWindow((q, fmt) => canvasToBytes(canvas, fmt, q), options);
}
