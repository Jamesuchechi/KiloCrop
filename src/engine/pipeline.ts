import { renderPaddedBackdrop } from './backdrop';
import {
  closeBitmap,
  decodePreview,
  decodeWorkingBitmap,
  extractCroppedCanvas,
  releaseCanvas,
  scaleBitmapToCanvas,
} from './decode';
import { encodeAdaptiveCanvas, encodeCanvasToWindow } from './encode';
import { enhanceCanvas } from './enhance';
import {
  clampCropRect,
  computeCenteredCrop,
  computeFitPlan,
  resolveOutputDimensions,
} from './geometry';
import { inspectImageBytes } from './inspect';
import { assessEncodedQuality } from './quality-score';
import { computeBitmapSalience } from './salience';
import type {
  BitmapLike,
  CanvasLike,
  EncodeResult,
  EnginePlatform,
  InspectReport,
  PipelineStats,
  Rect,
  ResizeCompressOptions,
  ResizeCompressResult,
  ResizeCompressStats,
  Spec,
} from './types';

const HEADER_SLICE_BYTES = 262_144;

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

function isBitmapLike(source: Blob | BitmapLike): source is BitmapLike {
  return typeof (source as BitmapLike).close === 'function';
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
    createCanvas: (width, height): CanvasLike =>
      new OffscreenCanvas(width, height) as unknown as CanvasLike,
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

/**
 * Run step-down resize/crop/pad, optional salience auto-focus, auto-contrast & sharpen,
 * quality/KB encoding, and perceptual quality check with full EXIF strip and canvas cleanup.
 */
export async function runResizeCompress(
  source: Blob | BitmapLike,
  options: ResizeCompressOptions,
  report: InspectReport,
  platform: EnginePlatform,
  signal?: AbortSignal,
): Promise<{ result: ResizeCompressResult; stats: ResizeCompressStats }> {
  const tStart = performance.now();
  checkAborted(signal);

  const ownsBitmap = !isBitmapLike(source);
  const maxEdge = Math.min(
    4000,
    Math.max(3200, options.targetWidth ?? 0, options.targetHeight ?? 0),
  );

  let workingBitmap: BitmapLike | null = null;
  let canvas: CanvasLike | null = null;

  try {
    const tDecode = performance.now();
    workingBitmap = ownsBitmap
      ? await decodeWorkingBitmap(source, report.orientedDimensions, maxEdge, platform)
      : source;
    checkAborted(signal);

    const origDims = report.orientedDimensions ?? {
      width: workingBitmap.width,
      height: workingBitmap.height,
    };

    let effectiveFocalX = options.focalX ?? 0;
    let effectiveFocalY = options.focalY ?? 0;
    if (options.fit === 'fill' && options.autoFocus) {
      const est = computeBitmapSalience(workingBitmap, platform);
      effectiveFocalX = est.focalX;
      effectiveFocalY = est.focalY;
    }

    const plan = computeFitPlan(origDims, {
      targetWidth: options.targetWidth,
      targetHeight: options.targetHeight,
      fit: options.fit,
      dontEnlarge: options.dontEnlarge,
      focalX: effectiveFocalX,
      focalY: effectiveFocalY,
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

    canvas =
      plan.effectiveFit === 'pad'
        ? renderPaddedBackdrop(
            workingBitmap,
            mappedRect,
            plan.destRect,
            plan.outputDims,
            options.backdrop ?? 'blur',
            platform,
          )
        : scaleBitmapToCanvas(workingBitmap, mappedRect, plan.outputDims, platform);

    const decodeMs = Math.max(0, Math.round(performance.now() - tDecode));

    checkAborted(signal);

    const tEnhance = performance.now();
    const { contrastApplied, sharpenApplied } = enhanceCanvas(canvas, {
      autoContrast: options.autoContrast,
      sharpenPct: options.sharpenPct,
    });
    const enhanceMs = Math.max(0, Math.round(performance.now() - tEnhance));

    checkAborted(signal);

    const tEncode = performance.now();
    const encoded = await encodeAdaptiveCanvas(
      canvas,
      {
        format: options.format,
        quality: options.quality,
        minKb: options.minKb,
        maxKb: options.maxKb,
        dpi: options.dpi,
        allowShrinkToFitKb: options.allowShrinkToFitKb,
        signal,
      },
      platform,
    );

    const qualityAssessment =
      options.assessQuality === false
        ? null
        : await assessEncodedQuality(
            canvas,
            encoded.blob,
            encoded.actualFormat,
            options.maxKb,
            platform,
          );

    const encodeMs = Math.max(0, Math.round(performance.now() - tEncode));
    const totalMs = Math.max(0, Math.round(performance.now() - tStart));

    const fixedIssues = report.issues
      .filter((i) => i.severity === 'auto-fixed')
      .map((i) => i.title);
    if (report.hasExif || report.hasGpsExif) {
      fixedIssues.push('EXIF/GPS metadata stripped');
    }
    if (encoded.status === 'padded-min' && encoded.paddedBytes > 0) {
      fixedIssues.push(`COM padded (+${encoded.paddedBytes} B) to meet min KB`);
    }
    if (contrastApplied) {
      fixedIssues.push('Auto-contrast applied');
    }
    if (sharpenApplied) {
      fixedIssues.push(`Sharpened (${Math.round(options.sharpenPct)}%)`);
    }

    const result: ResizeCompressResult = {
      blob: encoded.blob,
      bytes: encoded.bytes,
      width: encoded.width,
      height: encoded.height,
      originalWidth: origDims.width,
      originalHeight: origDims.height,
      requestedFormat: encoded.requestedFormat,
      actualFormat: encoded.actualFormat,
      actualMime: encoded.actualMime,
      dpi: encoded.dpi,
      quality: encoded.quality,
      iterations: encoded.iterations,
      status: encoded.status,
      paddedBytes: encoded.paddedBytes,
      shrunkToFitKb: encoded.shrunkToFitKb,
      contrastApplied,
      sharpenApplied,
      cropped: plan.cropped,
      wasClampedToSafeArea: plan.wasClampedToSafeArea,
      appliedFocalX: effectiveFocalX,
      appliedFocalY: effectiveFocalY,
      qualityAssessment,
    };

    const stats: ResizeCompressStats = {
      decodeMs,
      enhanceMs,
      encodeMs,
      totalMs,
      inputBytes: report.fileBytes,
      outputBytes: encoded.bytes,
      originalWidth: origDims.width,
      originalHeight: origDims.height,
      outputWidth: encoded.width,
      outputHeight: encoded.height,
      format: encoded.actualFormat,
      quality: encoded.quality,
      iterations: encoded.iterations,
      status: encoded.status,
      contrastApplied,
      sharpenApplied,
      fixedIssues,
      outboundBytes: 0,
    };

    return { result, stats };
  } finally {
    releaseCanvas(canvas);
    if (ownsBitmap) {
      closeBitmap(workingBitmap);
    }
  }
}
