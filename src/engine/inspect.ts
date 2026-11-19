import { orientedDimensions } from './geometry';
import type { Dimensions, ImageContainer, InspectIssue, InspectReport } from './types';

function ascii(bytes: Uint8Array, start: number, len: number): string {
  if (start < 0 || start + len > bytes.length) return '';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(bytes[start + i]!);
  }
  return s;
}

function detectContainer(bytes: Uint8Array): ImageContainer {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (/^(heic|heix|mif1|msf1|hevc|hevx)$/i.test(brand)) {
      return 'heic';
    }
  }
  return 'unknown';
}

function parseExifApp1(
  bytes: Uint8Array,
  segStart: number,
  segEnd: number,
): { hasExif: boolean; orientation: number; hasGpsExif: boolean } {
  // segStart points at payload start right after length field
  if (segStart + 14 > segEnd || ascii(bytes, segStart, 6) !== 'Exif\0\0') {
    return { hasExif: false, orientation: 1, hasGpsExif: false };
  }

  const tiff = segStart + 6;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endian = dv.getUint16(tiff, false);
  if (endian !== 0x4949 && endian !== 0x4d4d) {
    return { hasExif: true, orientation: 1, hasGpsExif: false };
  }
  const le = endian === 0x4949;
  const ifdRel = dv.getUint32(tiff + 4, le);
  const ifd0 = tiff + ifdRel;
  if (ifd0 < tiff || ifd0 + 2 > segEnd) {
    return { hasExif: true, orientation: 1, hasGpsExif: false };
  }

  const count = dv.getUint16(ifd0, le);
  let orientation = 1;
  let hasGpsExif = false;

  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > segEnd) break;
    const tag = dv.getUint16(entry, le);
    if (tag === 0x0112) {
      const val = dv.getUint16(entry + 8, le);
      if (val >= 1 && val <= 8) orientation = val;
    } else if (tag === 0x8825) {
      hasGpsExif = true;
    }
  }

  return { hasExif: true, orientation, hasGpsExif };
}

/**
 * Zero-dependency binary header X-Ray running on the input ArrayBuffer slice.
 * Diagnoses silent portal rejection causes without external WASM/CV libraries.
 */
export function inspectImageBytes(
  bytes: Uint8Array,
  fileName: string,
  totalFileBytes = bytes.length,
): InspectReport {
  const container = detectContainer(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let rawDimensions: Dimensions | null = null;
  let orientation = 1;
  let isProgressiveJpeg = false;
  let hasExif = false;
  let hasGpsExif = false;
  let iccProfile: InspectReport['iccProfile'] = 'none';
  let isCmyk = false;

  if (container === 'png' && bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') {
    const w = dv.getUint32(16, false);
    const h = dv.getUint32(20, false);
    if (w > 0 && h > 0) rawDimensions = { width: w, height: h };
  } else if (container === 'jpeg') {
    let off = 2;
    while (off + 4 <= bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1]!;
      if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) {
        off += 2;
        continue;
      }
      const segLen = dv.getUint16(off + 2, false);
      if (segLen < 2 || off + 2 + segLen > bytes.length) break;

      const payloadStart = off + 4;
      const segEnd = off + 2 + segLen;

      if (marker === 0xc0 || marker === 0xc2) {
        if (marker === 0xc2) isProgressiveJpeg = true;
        if (segLen >= 8) {
          const h = dv.getUint16(off + 5, false);
          const w = dv.getUint16(off + 7, false);
          if (w > 0 && h > 0) rawDimensions = { width: w, height: h };
          if (segLen >= 10 && bytes[off + 9] === 4) {
            isCmyk = true;
          }
        }
      } else if (marker === 0xe1 && !hasExif) {
        const exif = parseExifApp1(bytes, payloadStart, segEnd);
        if (exif.hasExif) {
          hasExif = true;
          orientation = exif.orientation;
          hasGpsExif = exif.hasGpsExif;
        }
      } else if (marker === 0xe2 && payloadStart + 14 <= segEnd) {
        if (ascii(bytes, payloadStart, 12) === 'ICC_PROFILE\0') {
          const textSlice = ascii(
            bytes,
            payloadStart + 14,
            Math.min(512, segEnd - (payloadStart + 14)),
          );
          if (/display\s*p3|\bp3\b/i.test(textSlice)) {
            iccProfile = 'display-p3';
          } else if (/srgb/i.test(textSlice)) {
            iccProfile = 'srgb';
          } else if (iccProfile === 'none') {
            iccProfile = 'other';
          }
        }
      }

      off = segEnd;
    }
  }

  const oriented = rawDimensions ? orientedDimensions(rawDimensions, orientation) : null;
  const issues: InspectIssue[] = [];

  if (container === 'heic') {
    issues.push({
      code: 'heic-container',
      severity: 'blocking',
      title: 'iPhone HEIC photo format',
      detail:
        'Chrome on Windows/Android cannot decode HEIC natively. On iPhone: open this page in Safari, or enable Settings → Camera → Formats → Most Compatible (JPEG).',
    });
  }

  const extMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1]! : '';
  if ((container === 'png' || container === 'webp') && (ext === 'jpg' || ext === 'jpeg')) {
    issues.push({
      code: 'extension-mismatch',
      severity: 'auto-fixed',
      title: `${container.toUpperCase()} file renamed as .${ext}`,
      detail:
        'True image header did not match its .jpg extension; exported as clean baseline JPEG.',
    });
  } else if (container === 'jpeg' && (ext === 'jpeg' || ext === 'png' || ext === 'webp')) {
    issues.push({
      code: 'extension-mismatch',
      severity: 'auto-fixed',
      title: `Non-standard .${ext} filename`,
      detail: 'Normalized output to strict .jpg extension required by strict portals.',
    });
  }

  if (isProgressiveJpeg) {
    issues.push({
      code: 'progressive-jpeg',
      severity: 'auto-fixed',
      title: 'Progressive JPEG (SOF2)',
      detail: 'Legacy portals frequently reject progressive JPEGs; exported as Baseline JPEG.',
    });
  }

  if (orientation !== 1) {
    issues.push({
      code: 'exif-orientation',
      severity: 'auto-fixed',
      title: `Sideways EXIF rotation (${orientation})`,
      detail: 'Phone rotation baked into upright pixels before stripping EXIF metadata.',
    });
  }

  if (isCmyk) {
    issues.push({
      code: 'cmyk-color',
      severity: 'auto-fixed',
      title: 'CMYK color channels',
      detail: 'Normalized 4-channel CMYK input to standard sRGB JPEG.',
    });
  } else if (iccProfile === 'display-p3' || iccProfile === 'other') {
    issues.push({
      code: 'non-srgb-icc',
      severity: 'auto-fixed',
      title:
        iccProfile === 'display-p3' ? 'Display-P3 wide-gamut profile' : 'Non-sRGB color profile',
      detail: 'Normalized to sRGB so portal viewers will not wash out skin tones.',
    });
  }

  // Advisory WhatsApp-compression heuristic: no EXIF + classic WhatsApp edge + low bytes/pixel
  if (container === 'jpeg' && !hasExif && oriented) {
    const longEdge = Math.max(oriented.width, oriented.height);
    const pixels = oriented.width * oriented.height;
    const bpp = pixels > 0 ? totalFileBytes / pixels : 1;
    if ((longEdge === 1600 || longEdge === 1280 || longEdge === 800) && bpp < 0.16) {
      issues.push({
        code: 'whatsapp-compressed',
        severity: 'advisory',
        title: 'Likely compressed via WhatsApp',
        detail:
          'Ask the sender to forward the original photo via WhatsApp → Document for sharper detail.',
      });
    }
  }

  return {
    container,
    fileName,
    fileBytes: totalFileBytes,
    rawDimensions,
    orientedDimensions: oriented,
    orientation,
    isProgressiveJpeg,
    hasExif,
    hasGpsExif,
    iccProfile,
    isCmyk,
    issues,
  };
}
