import { closeBitmap, releaseCanvas } from './decode';
import { computePreviewScale } from './geometry';
import type {
  BitmapLike,
  CanvasLike,
  EnginePlatform,
  OutputFormat,
  QualityAssessment,
} from './types';

/** Compute Rec.709 integer luma PSNR in dB over opaque reference pixels (clamped [0, 60]). */
export function computeLumaPsnr(
  refData: Uint8ClampedArray,
  testData: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const pixelCount = width * height;
  if (pixelCount <= 0 || refData.length < pixelCount * 4 || testData.length < pixelCount * 4) {
    return 60;
  }

  let mseSum = 0;
  let count = 0;

  for (let i = 0; i < pixelCount * 4; i += 4) {
    if (refData[i + 3]! === 0) continue;
    const l1 = (refData[i]! * 54 + refData[i + 1]! * 183 + refData[i + 2]! * 19) >> 8;
    const l2 = (testData[i]! * 54 + testData[i + 1]! * 183 + testData[i + 2]! * 19) >> 8;
    const d = l1 - l2;
    mseSum += d * d;
    count++;
  }

  if (count === 0) return 60;
  const mse = mseSum / count;
  if (mse <= 0.0001) return 60;
  const psnr = 10 * Math.log10((255 * 255) / mse);
  return Math.max(0, Math.min(60, Number(psnr.toFixed(1))));
}

export function classifyQuality(
  psnr: number,
  format: OutputFormat,
  maxKb: number | null,
): QualityAssessment {
  const band = psnr >= 35 ? 'crisp' : psnr >= 28 ? 'good' : 'artifacted';
  return {
    psnr,
    band,
    suggestWebp: band === 'artifacted' && format === 'jpeg' && maxKb !== null,
  };
}

/**
 * Fast <= 128px perceptual quality check comparing the encoded Blob against the
 * pre-encode canvas using identical drawImage resampling kernels so subpixel
 * downscale differences do not masquerade as compression artifacts.
 */
export async function assessEncodedQuality(
  referenceCanvas: CanvasLike,
  encodedBlob: Blob,
  format: OutputFormat,
  maxKb: number | null,
  platform: EnginePlatform,
): Promise<QualityAssessment | null> {
  if (format === 'png') {
    return { psnr: 60, band: 'crisp', suggestWebp: false };
  }

  const thumb = computePreviewScale(
    { width: referenceCanvas.width, height: referenceCanvas.height },
    128,
  );

  let refTiny: CanvasLike | null = null;
  let testTiny: CanvasLike | null = null;
  let decodedBmp: BitmapLike | null = null;

  try {
    refTiny = platform.createCanvas(thumb.width, thumb.height);
    const rCtx = refTiny.getContext('2d');
    if (!rCtx || typeof rCtx.getImageData !== 'function') {
      return null;
    }

    decodedBmp = await platform.createImageBitmap(encodedBlob, {
      imageOrientation: 'none',
    });

    testTiny = platform.createCanvas(thumb.width, thumb.height);
    const tCtx = testTiny.getContext('2d');
    if (!tCtx || typeof tCtx.getImageData !== 'function') {
      return null;
    }

    if (format === 'jpeg') {
      rCtx.fillStyle = '#ffffff';
      rCtx.fillRect(0, 0, thumb.width, thumb.height);
    }

    rCtx.imageSmoothingEnabled = true;
    rCtx.imageSmoothingQuality = 'medium';
    rCtx.drawImage(
      referenceCanvas,
      0,
      0,
      referenceCanvas.width,
      referenceCanvas.height,
      0,
      0,
      thumb.width,
      thumb.height,
    );

    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = 'medium';
    tCtx.drawImage(
      decodedBmp,
      0,
      0,
      decodedBmp.width,
      decodedBmp.height,
      0,
      0,
      thumb.width,
      thumb.height,
    );

    const refImg = rCtx.getImageData(0, 0, thumb.width, thumb.height);
    const testImg = tCtx.getImageData(0, 0, thumb.width, thumb.height);
    const psnr = computeLumaPsnr(refImg.data, testImg.data, thumb.width, thumb.height);
    return classifyQuality(psnr, format, maxKb);
  } catch {
    return null;
  } finally {
    closeBitmap(decodedBmp);
    releaseCanvas(refTiny);
    releaseCanvas(testTiny);
  }
}
