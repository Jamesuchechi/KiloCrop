import { decodePreview, extractCroppedCanvas, releaseCanvas } from './decode';
import { encodeCanvasToWindow } from './encode';
import { computeCenteredCrop, resolveOutputDimensions } from './geometry';
import { inspectImageBytes } from './inspect';
import type {
  BitmapLike,
  CanvasLike,
  EncodeResult,
  EnginePlatform,
  InspectReport,
  PipelineStats,
  Rect,
  Spec,
} from './types';

const HEADER_SLICE_BYTES = 262_144;

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

/** Worker-safe OffscreenCanvas + createImageBitmap platform adapter (no DOM globals). */
export function createOffscreenPlatform(): EnginePlatform {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('OffscreenCanvas or createImageBitmap is unavailable in this context.');
  }
  return {
    createImageBitmap: (source, options) => createImageBitmap(source, options),
    createCroppedImageBitmap: (source, sx, sy, sw, sh, options) =>
      createImageBitmap(source, sx, sy, sw, sh, options),
    createCanvas: (width, height): CanvasLike => new OffscreenCanvas(width, height),
  };
}

/** Inspect only the header slice (<= 256 KB) using the zero-dep DataView X-Ray. */
export async function runInspect(
  blob: Blob,
  fileName: string,
  signal?: AbortSignal,
): Promise<InspectReport> {
  checkAborted(signal);
  const slice = blob.slice(0, Math.min(blob.size, HEADER_SLICE_BYTES));
  const buf = await slice.arrayBuffer();
  checkAborted(signal);
  return inspectImageBytes(new Uint8Array(buf), fileName, blob.size);
}

/** Decode a memory-safe <= 1600 px oriented preview bitmap. */
export async function runPreview(
  blob: Blob,
  report: InspectReport,
  platform: EnginePlatform,
  signal?: AbortSignal,
): Promise<BitmapLike> {
  checkAborted(signal);
  return decodePreview(blob, report.rawDimensions, report.orientation, platform);
}

export interface RunExportOptions {
  signal?: AbortSignal;
  useCropAtDecode?: boolean;
}

/** Run full crop extraction, KB-window encoding, DPI patching, and canvas cleanup. */
export async function runExport(
  blob: Blob,
  spec: Spec,
  cropRect: Rect | null,
  report: InspectReport,
  platform: EnginePlatform,
  options: RunExportOptions = {},
): Promise<{ result: EncodeResult; stats: PipelineStats }> {
  const { signal, useCropAtDecode = false } = options;
  const tStart = performance.now();
  checkAborted(signal);

  const outDims = resolveOutputDimensions(spec);
  let effectiveOriented = report.orientedDimensions;
  let effectiveCrop = cropRect;

  if (!effectiveCrop) {
    if (!effectiveOriented) {
      const probeBmp = await decodePreview(blob, null, report.orientation, platform);
      effectiveOriented = { width: probeBmp.width, height: probeBmp.height };
      probeBmp.close();
    }
    effectiveCrop = computeCenteredCrop(effectiveOriented, outDims.width / outDims.height);
  }

  let canvas: CanvasLike | null = null;
  try {
    const tDecode = performance.now();
    canvas = await extractCroppedCanvas(
      blob,
      effectiveCrop,
      effectiveOriented,
      { width: outDims.width, height: outDims.height },
      platform,
      { useCropAtDecode },
    );
    const decodeMs = Math.max(0, Math.round(performance.now() - tDecode));

    checkAborted(signal);

    const tEncode = performance.now();
    const result = await encodeCanvasToWindow(canvas, {
      width: outDims.width,
      height: outDims.height,
      format: spec.output.format,
      minKb: spec.output.fileSizeKb.min,
      maxKb: spec.output.fileSizeKb.max,
      dpi: outDims.dpi,
      signal,
    });
    const encodeMs = Math.max(0, Math.round(performance.now() - tEncode));
    const totalMs = Math.max(0, Math.round(performance.now() - tStart));

    const fixedIssues = report.issues
      .filter((i) => i.severity === 'auto-fixed')
      .map((i) => i.title);
    if (report.hasExif || report.hasGpsExif) {
      fixedIssues.push('EXIF/GPS metadata stripped');
    }
    if (result.status === 'padded-min' && result.paddedBytes > 0) {
      fixedIssues.push(`COM padded (+${result.paddedBytes} B) to meet min KB`);
    }

    return {
      result,
      stats: {
        decodeMs,
        encodeMs,
        totalMs,
        inputBytes: blob.size,
        outputBytes: result.bytes,
        outputWidth: result.width,
        outputHeight: result.height,
        quality: result.quality,
        iterations: result.iterations,
        status: result.status,
        fixedIssues,
        outboundBytes: 0,
      },
    };
  } finally {
    releaseCanvas(canvas);
  }
}
