import { closeBitmap, decodeWorkingBitmap, releaseCanvas, scaleBitmapToCanvas } from './decode';
import { encodeAdaptiveCanvas } from './encode';
import { enhanceCanvas } from './enhance';
import { formatExtension } from './presets';
import type {
  BitmapLike,
  CanvasLike,
  EnginePlatform,
  InspectReport,
  WebKitAsset,
  WebKitOptions,
  WebKitResult,
} from './types';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

function isBitmapLike(source: Blob | BitmapLike): source is BitmapLike {
  return typeof (source as BitmapLike).close === 'function';
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function sanitizeWebKitStem(rawName: string): string {
  const noExt = rawName.replace(/\.[^.]+$/, '');
  const slug = noExt
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'hero';
}

/**
 * Resolve ascending export widths <= sourceWidth (never upscales past original width).
 */
export function resolveWebKitWidths(
  sourceWidth: number,
  requestedWidths: readonly number[],
): number[] {
  const safeSrc = Math.max(1, Math.round(sourceWidth));
  const cleanReq = Array.from(
    new Set(
      requestedWidths
        .map((w) => Math.round(w))
        .filter((w) => Number.isFinite(w) && w >= 16 && w <= 8000),
    ),
  ).sort((a, b) => a - b);

  if (cleanReq.length === 0) {
    return [safeSrc];
  }

  const kept = cleanReq.filter((w) => w <= safeSrc);
  const hadLarger = cleanReq.some((w) => w > safeSrc);

  if (kept.length === 0) {
    return [safeSrc];
  }

  const largestKept = kept[kept.length - 1]!;
  if (hadLarger && safeSrc > largestKept * 1.15 && !kept.includes(safeSrc)) {
    kept.push(safeSrc);
  }

  return kept;
}

/** Pure RFC 4648 base64 encoder (DOM-free, safe for binary Uint8Arrays). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;

    out += BASE64_ALPHABET[(triplet >>> 18) & 0x3f];
    out += BASE64_ALPHABET[(triplet >>> 12) & 0x3f];
    out += hasB1 ? BASE64_ALPHABET[(triplet >>> 6) & 0x3f] : '=';
    out += hasB2 ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return out;
}

export interface PictureMarkupInput {
  prefix: string;
  alt: string;
  sizes: string;
  webpAssets: readonly WebKitAsset[];
  fallbackAssets: readonly WebKitAsset[];
  width: number;
  height: number;
}

function joinPrefix(prefix: string, filename: string): string {
  const cleanPrefix = prefix.trim();
  if (!cleanPrefix) return filename;
  const normalized = cleanPrefix.endsWith('/') ? cleanPrefix : `${cleanPrefix}/`;
  return `${normalized}${filename}`;
}

export function buildPictureMarkup(params: PictureMarkupInput): string {
  const safeAlt = escapeHtmlAttr(params.alt.trim() || 'Responsive image');
  const safeSizes = escapeHtmlAttr(params.sizes.trim() || '100vw');

  const webpSorted = [...params.webpAssets].sort((a, b) => a.width - b.width);
  const fallbackSorted = [...params.fallbackAssets].sort((a, b) => a.width - b.width);

  const webpSrcset = webpSorted
    .map((a) => `${escapeHtmlAttr(joinPrefix(params.prefix, a.filename))} ${a.width}w`)
    .join(', ');

  const imgList = fallbackSorted.length > 0 ? fallbackSorted : webpSorted;
  const primary = imgList[imgList.length - 1];
  const imgSrc = primary ? escapeHtmlAttr(joinPrefix(params.prefix, primary.filename)) : '';
  const imgSrcset = imgList
    .map((a) => `${escapeHtmlAttr(joinPrefix(params.prefix, a.filename))} ${a.width}w`)
    .join(', ');

  const lines: string[] = ['<picture>'];
  if (webpSrcset && fallbackSorted.length > 0) {
    lines.push(`  <source type="image/webp" srcset="${webpSrcset}" sizes="${safeSizes}">`);
  }
  const srcsetAttr = imgSrcset ? ` srcset="${imgSrcset}" sizes="${safeSizes}"` : '';
  lines.push(
    `  <img src="${imgSrc}"${srcsetAttr} width="${params.width}" height="${params.height}" alt="${safeAlt}" loading="lazy" decoding="async">`,
  );
  lines.push('</picture>');
  return lines.join('\n');
}

async function generateLqipDataUri(
  working: BitmapLike,
  platform: EnginePlatform,
  signal?: AbortSignal,
): Promise<{ dataUri: string; width: number; height: number; bytes: number }> {
  const lqipW = Math.min(20, Math.max(1, working.width));
  const lqipH = Math.max(1, Math.round((working.height / Math.max(1, working.width)) * lqipW));

  let tiny: CanvasLike | null = null;
  let soft: CanvasLike | null = null;
  try {
    tiny = platform.createCanvas(lqipW, lqipH);
    const tCtx = tiny.getContext('2d');
    if (!tCtx) throw new Error('2D context unavailable for LQIP');
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = 'high';
    tCtx.drawImage(working, 0, 0, working.width, working.height, 0, 0, lqipW, lqipH);

    // Light 2nd smoothed pass softens high-frequency micro-blocks cleanly
    soft = platform.createCanvas(lqipW, lqipH);
    const sCtx = soft.getContext('2d');
    if (!sCtx) throw new Error('2D context unavailable for LQIP');
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';
    sCtx.drawImage(tiny, 0, 0, lqipW, lqipH, 0, 0, lqipW, lqipH);

    const enc = await encodeAdaptiveCanvas(
      soft,
      {
        format: 'webp',
        quality: 0.55,
        minKb: null,
        maxKb: null,
        dpi: null,
        allowShrinkToFitKb: false,
        signal,
      },
      platform,
    );
    const rawBytes = new Uint8Array(await enc.blob.arrayBuffer());
    const b64 = bytesToBase64(rawBytes);
    const mime = enc.actualMime || 'image/webp';
    return {
      dataUri: `data:${mime};base64,${b64}`,
      width: lqipW,
      height: lqipH,
      bytes: rawBytes.length,
    };
  } finally {
    releaseCanvas(tiny);
    releaseCanvas(soft);
  }
}

/** Generate sequential responsive WebP/JPEG variants, optional 20px LQIP, and <picture> HTML. */
export async function runWebKitExport(
  source: Blob | BitmapLike,
  options: WebKitOptions,
  report: InspectReport,
  platform: EnginePlatform,
  signal?: AbortSignal,
): Promise<WebKitResult> {
  checkAborted(signal);
  const ownsBitmap = !isBitmapLike(source);
  const maxReqWidth = options.widths.reduce((m, w) => Math.max(m, w), 0);
  const maxEdge = Math.min(4000, Math.max(2400, maxReqWidth));

  let workingBitmap: BitmapLike | null = null;
  try {
    workingBitmap = ownsBitmap
      ? await decodeWorkingBitmap(source, report.orientedDimensions, maxEdge, platform)
      : source;
    checkAborted(signal);

    const origDims = report.orientedDimensions ?? {
      width: workingBitmap.width,
      height: workingBitmap.height,
    };

    const stem = sanitizeWebKitStem(options.baseName);
    const targetWidths = resolveWebKitWidths(origDims.width, options.widths);
    const wantWebp = options.includeWebp || !options.includeJpeg;
    const wantJpeg = options.includeJpeg;
    const requestedFormats: Array<'webp' | 'jpeg'> = [];
    if (wantWebp) requestedFormats.push('webp');
    if (wantJpeg) requestedFormats.push('jpeg');

    const assets: WebKitAsset[] = [];
    const seenFilenames = new Set<string>();
    const fullRect = { x: 0, y: 0, width: workingBitmap.width, height: workingBitmap.height };

    for (const targetW of targetWidths) {
      checkAborted(signal);
      const targetH = Math.max(1, Math.round((origDims.height / origDims.width) * targetW));
      let canvas: CanvasLike | null = null;
      try {
        canvas = scaleBitmapToCanvas(
          workingBitmap,
          fullRect,
          { width: targetW, height: targetH },
          platform,
        );
        checkAborted(signal);

        enhanceCanvas(canvas, {
          autoContrast: options.autoContrast,
          sharpenPct: options.sharpenPct,
        });

        for (const reqFmt of requestedFormats) {
          checkAborted(signal);
          const encoded = await encodeAdaptiveCanvas(
            canvas,
            {
              format: reqFmt,
              quality: options.quality,
              minKb: null,
              maxKb: null,
              dpi: null,
              allowShrinkToFitKb: false,
              signal,
            },
            platform,
          );
          const ext = formatExtension(encoded.actualFormat);
          const filename = `${stem}-${encoded.width}w.${ext}`;
          if (seenFilenames.has(filename)) continue;
          seenFilenames.add(filename);

          assets.push({
            filename,
            width: encoded.width,
            height: encoded.height,
            format: encoded.actualFormat,
            mime: encoded.actualMime,
            bytes: encoded.bytes,
            blob: encoded.blob,
          });
        }
      } finally {
        releaseCanvas(canvas);
      }
    }

    let lqipDataUri: string | null = null;
    let lqipWidth = 0;
    let lqipHeight = 0;
    let lqipBytes = 0;
    if (options.includeLqip) {
      const lqip = await generateLqipDataUri(workingBitmap, platform, signal);
      lqipDataUri = lqip.dataUri;
      lqipWidth = lqip.width;
      lqipHeight = lqip.height;
      lqipBytes = lqip.bytes;
    }

    const webpAssets = assets.filter((a) => a.format === 'webp');
    const fallbackAssets = assets.filter((a) => a.format !== 'webp');
    const lastAsset = assets[assets.length - 1];
    const pictureHtml = buildPictureMarkup({
      prefix: options.assetPrefix,
      alt: options.altText,
      sizes: options.sizesAttr,
      webpAssets,
      fallbackAssets,
      width: lastAsset?.width ?? origDims.width,
      height: lastAsset?.height ?? origDims.height,
    });

    return {
      stem,
      sourceWidth: origDims.width,
      sourceHeight: origDims.height,
      assets,
      lqipDataUri,
      lqipWidth,
      lqipHeight,
      lqipBytes,
      pictureHtml,
    };
  } finally {
    if (ownsBitmap) {
      closeBitmap(workingBitmap);
    }
  }
}
