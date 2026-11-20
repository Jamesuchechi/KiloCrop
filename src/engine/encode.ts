import { flattenCanvasForJpeg, releaseCanvas, scaleCanvasToDimensions } from './decode';
import { padJpegWithCom, setJpegDpi, setPngDpi } from './dpi';
import type { CanvasLike, EncodeResult, EncodeStatus, EnginePlatform, OutputFormat } from './types';

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

export interface AdaptiveEncodeOptions {
  format: OutputFormat;
  quality: number;
  minKb: number | null;
  maxKb: number | null;
  dpi: number | null;
  allowShrinkToFitKb?: boolean;
  signal?: AbortSignal;
}

export interface AdaptiveEncodeResult {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  requestedFormat: OutputFormat;
  actualFormat: OutputFormat;
  actualMime: string;
  dpi: number | null;
  quality: number;
  iterations: number;
  status: EncodeStatus;
  paddedBytes: number;
  shrunkToFitKb: boolean;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

export function formatToMime(format: OutputFormat): string {
  if (format === 'webp') return 'image/webp';
  if (format === 'png') return 'image/png';
  return 'image/jpeg';
}

export function mimeToFormat(mime: string, fallback: OutputFormat): OutputFormat {
  const lower = mime.toLowerCase();
  if (lower === 'image/webp') return 'webp';
  if (lower === 'image/png') return 'png';
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'jpeg';
  return fallback;
}

function applyDpi(bytes: Uint8Array, format: OutputFormat, dpi: number | null): Uint8Array {
  if (!dpi || dpi <= 0 || format === 'webp') return bytes;
  return format === 'png' ? setPngDpi(bytes, dpi) : setJpegDpi(bytes, dpi);
}

/** Encode a CanvasLike and preserve detected output MIME (handles browser WebP fallback). */
export async function canvasToEncodedBytes(
  canvas: CanvasLike,
  format: OutputFormat,
  quality: number,
): Promise<{ bytes: Uint8Array; actualFormat: OutputFormat; actualMime: string }> {
  const mime = formatToMime(format);
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

  const actualMime = blob.type || mime;
  const actualFormat = mimeToFormat(actualMime, format);
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    actualFormat,
    actualMime,
  };
}

/** Encode a CanvasLike (OffscreenCanvas or HTMLCanvasElement) to raw bytes. */
export async function canvasToBytes(
  canvas: CanvasLike,
  format: OutputFormat,
  quality: number,
): Promise<Uint8Array> {
  const { bytes } = await canvasToEncodedBytes(canvas, format, quality);
  return bytes;
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
  const mime = formatToMime(format);

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
    const bytes = applyDpi(await encodeAtQuality(0.92, format), format, dpi);
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
      const bytes = applyDpi(await encodeAtQuality(q, format), format, dpi);
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
      const floorBytes = applyDpi(await encodeAtQuality(qualityFloor, format), format, dpi);
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
    const bytes = applyDpi(await encodeAtQuality(0.92, format), format, dpi);
    iterations = 1;
    best = { bytes, quality: 0.92 };
  }

  // Handle minimum KB requirement if set (COM padding applies cleanly to JPEG)
  if (minBytes !== null && best.bytes.length < minBytes) {
    checkAborted(signal);
    const maxQBytes = applyDpi(await encodeAtQuality(1.0, format), format, dpi);
    iterations++;
    if (
      maxQBytes.length > best.bytes.length &&
      (maxBytes === null || maxQBytes.length <= maxBytes)
    ) {
      best = { bytes: maxQBytes, quality: 1.0 };
    }

    if (best.bytes.length < minBytes) {
      if (format === 'jpeg') {
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

interface SingleCanvasAttempt {
  bytes: Uint8Array;
  actualFormat: OutputFormat;
  actualMime: string;
  quality: number;
  iterations: number;
  status: EncodeStatus;
  paddedBytes: number;
}

async function encodeSingleCanvasToWindow(
  curCanvas: CanvasLike,
  requestedFormat: OutputFormat,
  requestedQuality: number,
  minBytes: number | null,
  maxBytes: number | null,
  dpi: number | null,
  platform: EnginePlatform,
  signal?: AbortSignal,
): Promise<SingleCanvasAttempt> {
  let targetCanvas = curCanvas;
  let ownsFlattened = false;
  if (requestedFormat === 'jpeg') {
    targetCanvas = flattenCanvasForJpeg(curCanvas, platform);
    ownsFlattened = true;
  }

  try {
    const encodeOnce = async (q: number) => {
      checkAborted(signal);
      const enc = await canvasToEncodedBytes(targetCanvas, requestedFormat, q);
      const patched = applyDpi(enc.bytes, enc.actualFormat, dpi);
      return {
        bytes: patched,
        actualFormat: enc.actualFormat,
        actualMime: enc.actualMime,
      };
    };

    if (minBytes === null && maxBytes === null) {
      const q = requestedFormat === 'png' ? 1 : Math.max(0.4, Math.min(1, requestedQuality));
      const enc = await encodeOnce(q);
      return {
        ...enc,
        quality: q,
        iterations: 1,
        status: 'ok',
        paddedBytes: 0,
      };
    }

    if (requestedFormat === 'png') {
      const enc = await encodeOnce(1);
      let status: EncodeStatus = 'ok';
      if (maxBytes !== null && enc.bytes.length > maxBytes) status = 'infeasible-max';
      else if (minBytes !== null && enc.bytes.length < minBytes) status = 'below-min';
      return {
        ...enc,
        quality: 1,
        iterations: 1,
        status,
        paddedBytes: 0,
      };
    }

    let iterations = 0;
    let best: {
      bytes: Uint8Array;
      actualFormat: OutputFormat;
      actualMime: string;
      quality: number;
    } | null = null;
    let smallestOver: {
      bytes: Uint8Array;
      actualFormat: OutputFormat;
      actualMime: string;
      quality: number;
    } | null = null;

    if (maxBytes !== null) {
      const floor = 0.3;
      let lo = floor;
      let hi = 0.95;

      while (iterations < 7 && hi - lo > 0.01) {
        const q = (lo + hi) / 2;
        const enc = await encodeOnce(q);
        iterations++;

        if (enc.bytes.length <= maxBytes) {
          if (!best || q > best.quality) {
            best = { ...enc, quality: q };
          }
          lo = q;
        } else {
          if (!smallestOver || enc.bytes.length < smallestOver.bytes.length) {
            smallestOver = { ...enc, quality: q };
          }
          hi = q;
        }
      }

      if (!best) {
        const floorEnc = await encodeOnce(floor);
        iterations++;
        if (floorEnc.bytes.length <= maxBytes) {
          best = { ...floorEnc, quality: floor };
        } else {
          const chosen =
            smallestOver && smallestOver.bytes.length < floorEnc.bytes.length
              ? smallestOver
              : { ...floorEnc, quality: floor };
          return {
            ...chosen,
            iterations,
            status: 'infeasible-max',
            paddedBytes: 0,
          };
        }
      }
    } else {
      const enc = await encodeOnce(Math.max(0.4, Math.min(1, requestedQuality)));
      iterations = 1;
      best = { ...enc, quality: Math.max(0.4, Math.min(1, requestedQuality)) };
    }

    if (minBytes !== null && best.bytes.length < minBytes) {
      const maxQ = await encodeOnce(1.0);
      iterations++;
      if (
        maxQ.bytes.length > best.bytes.length &&
        (maxBytes === null || maxQ.bytes.length <= maxBytes)
      ) {
        best = { ...maxQ, quality: 1.0 };
      }

      if (best.bytes.length < minBytes) {
        if (best.actualFormat === 'jpeg') {
          const target = Math.max(minBytes, best.bytes.length + 4);
          if (maxBytes === null || target <= maxBytes) {
            const padded = padJpegWithCom(best.bytes, target);
            const added = padded.length - best.bytes.length;
            if (padded.length >= minBytes && (maxBytes === null || padded.length <= maxBytes)) {
              return {
                bytes: padded,
                actualFormat: best.actualFormat,
                actualMime: best.actualMime,
                quality: best.quality,
                iterations,
                status: 'padded-min',
                paddedBytes: added,
              };
            }
          }
        }

        return {
          ...best,
          iterations,
          status: 'below-min',
          paddedBytes: 0,
        };
      }
    }

    return {
      ...best,
      iterations,
      status: 'ok',
      paddedBytes: 0,
    };
  } finally {
    if (ownsFlattened) {
      releaseCanvas(targetCanvas);
    }
  }
}

/**
 * Adaptive encoder: uses quality slider when unbounded, or searches quality + optionally
 * steps down pixel dimensions (0.9x per step, up to 14 steps) until output <= maxKb.
 * Never releases the caller's initial `canvas`; releases all internal intermediates.
 */
export async function encodeAdaptiveCanvas(
  canvas: CanvasLike,
  options: AdaptiveEncodeOptions,
  platform: EnginePlatform,
): Promise<AdaptiveEncodeResult> {
  const { format, quality, minKb, maxKb, dpi, allowShrinkToFitKb = true, signal } = options;

  const rawMin = minKb !== null && minKb > 0 ? Math.round(minKb * 1024) : null;
  const maxBytes = maxKb !== null && maxKb > 0 ? Math.round(maxKb * 1024) : null;
  const minBytes = rawMin !== null && (maxBytes === null || rawMin <= maxBytes) ? rawMin : null;

  let cur: CanvasLike = canvas;
  let totalIterations = 0;
  let shrunkToFitKb = false;

  try {
    let attempt = await encodeSingleCanvasToWindow(
      cur,
      format,
      quality,
      minBytes,
      maxBytes,
      dpi,
      platform,
      signal,
    );
    totalIterations += attempt.iterations;

    if (maxBytes !== null && attempt.bytes.length > maxBytes && allowShrinkToFitKb) {
      for (let step = 0; step < 14; step++) {
        checkAborted(signal);
        const nw = Math.max(1, Math.round(cur.width * 0.9));
        const nh = Math.max(1, Math.round(cur.height * 0.9));
        if (nw === cur.width && nh === cur.height) break;

        const nextCanvas = scaleCanvasToDimensions(cur, nw, nh, platform);
        if (cur !== canvas) {
          releaseCanvas(cur);
        }
        cur = nextCanvas;
        shrunkToFitKb = true;

        attempt = await encodeSingleCanvasToWindow(
          cur,
          format,
          quality,
          minBytes,
          maxBytes,
          dpi,
          platform,
          signal,
        );
        totalIterations += attempt.iterations;

        if (attempt.bytes.length <= maxBytes) {
          break;
        }
      }
    }

    return {
      blob: new Blob([new Uint8Array(attempt.bytes)], { type: attempt.actualMime }),
      bytes: attempt.bytes.length,
      width: cur.width,
      height: cur.height,
      requestedFormat: format,
      actualFormat: attempt.actualFormat,
      actualMime: attempt.actualMime,
      dpi,
      quality: attempt.quality,
      iterations: totalIterations,
      status: attempt.status,
      paddedBytes: attempt.paddedBytes,
      shrunkToFitKb,
    };
  } finally {
    if (cur !== canvas) {
      releaseCanvas(cur);
    }
  }
}
