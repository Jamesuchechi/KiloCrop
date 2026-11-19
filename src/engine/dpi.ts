const METERS_PER_INCH = 0.0254;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard IEEE 802.3 CRC32 used for PNG chunks. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ bytes[i]!) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false;
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

function findJfifApp0Offset(jpeg: Uint8Array): number {
  let off = 2;
  while (off + 4 <= jpeg.length) {
    if (jpeg[off] !== 0xff) break;
    const marker = jpeg[off + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) {
      off += 2;
      continue;
    }
    const segLen = ((jpeg[off + 2]! << 8) | jpeg[off + 3]!) >>> 0;
    if (segLen < 2 || off + 2 + segLen > jpeg.length) break;
    if (
      marker === 0xe0 &&
      segLen >= 16 &&
      jpeg[off + 4] === 0x4a && // J
      jpeg[off + 5] === 0x46 && // F
      jpeg[off + 6] === 0x49 && // I
      jpeg[off + 7] === 0x46 && // F
      jpeg[off + 8] === 0x00
    ) {
      return off;
    }
    off += 2 + segLen;
  }
  return -1;
}

/** Patch existing JFIF APP0 or insert one after SOI so print shops read exact DPI. */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (!isJpeg(jpeg) || !Number.isFinite(dpi) || dpi <= 0) return jpeg;
  const clampedDpi = Math.max(1, Math.min(65535, Math.round(dpi)));
  const app0Off = findJfifApp0Offset(jpeg);

  if (app0Off >= 0) {
    const out = new Uint8Array(jpeg);
    out[app0Off + 11] = 1; // units: pixels per inch
    out[app0Off + 12] = (clampedDpi >> 8) & 0xff;
    out[app0Off + 13] = clampedDpi & 0xff;
    out[app0Off + 14] = (clampedDpi >> 8) & 0xff;
    out[app0Off + 15] = clampedDpi & 0xff;
    return out;
  }

  // 18-byte JFIF APP0 segment inserted right after SOI (FF D8)
  const app0 = new Uint8Array([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    (clampedDpi >> 8) & 0xff,
    clampedDpi & 0xff,
    (clampedDpi >> 8) & 0xff,
    clampedDpi & 0xff,
    0x00,
    0x00,
  ]);

  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}

/** Read X/Y DPI from a JPEG's JFIF APP0 header, or null if absent/unitless. */
export function readJpegDpi(jpeg: Uint8Array): { xDpi: number; yDpi: number } | null {
  if (!isJpeg(jpeg)) return null;
  const off = findJfifApp0Offset(jpeg);
  if (off < 0) return null;
  const units = jpeg[off + 11]!;
  const x = (jpeg[off + 12]! << 8) | jpeg[off + 13]!;
  const y = (jpeg[off + 14]! << 8) | jpeg[off + 15]!;
  if (units === 1) return { xDpi: x, yDpi: y };
  if (units === 2) return { xDpi: Math.round(x * 2.54), yDpi: Math.round(y * 2.54) };
  return null;
}

function buildPhysChunk(dpi: number): Uint8Array {
  const ppm = Math.max(1, Math.round(dpi / METERS_PER_INCH));
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9, false); // payload length
  chunk[4] = 0x70; // p
  chunk[5] = 0x48; // H
  chunk[6] = 0x59; // Y
  chunk[7] = 0x73; // s
  dv.setUint32(8, ppm, false);
  dv.setUint32(12, ppm, false);
  chunk[16] = 1; // unit: meters
  const crc = crc32(chunk.subarray(4, 17));
  dv.setUint32(17, crc, false);
  return chunk;
}

/** Insert or replace the PNG pHYs chunk immediately after IHDR. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png) || !Number.isFinite(dpi) || dpi <= 0) return png;
  const phys = buildPhysChunk(dpi);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);

  let off = 8;
  let ihdrEnd = -1;
  let physStart = -1;
  let physEnd = -1;

  while (off + 12 <= png.length) {
    const len = dv.getUint32(off, false);
    const total = 12 + len;
    if (off + total > png.length) break;
    const type = String.fromCharCode(png[off + 4]!, png[off + 5]!, png[off + 6]!, png[off + 7]!);
    if (type === 'IHDR' && ihdrEnd < 0) ihdrEnd = off + total;
    if (type === 'pHYs') {
      physStart = off;
      physEnd = off + total;
      break;
    }
    if (type === 'IEND') break;
    off += total;
  }

  if (physStart >= 0) {
    const out = new Uint8Array(png.length - (physEnd - physStart) + phys.length);
    out.set(png.subarray(0, physStart), 0);
    out.set(phys, physStart);
    out.set(png.subarray(physEnd), physStart + phys.length);
    return out;
  }

  if (ihdrEnd < 0) return png;
  const out = new Uint8Array(png.length + phys.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(phys, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + phys.length);
  return out;
}

/** Read X/Y DPI from a PNG's pHYs chunk, or null if absent/unitless. */
export function readPngDpi(png: Uint8Array): { xDpi: number; yDpi: number } | null {
  if (!isPng(png)) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  while (off + 12 <= png.length) {
    const len = dv.getUint32(off, false);
    const total = 12 + len;
    if (off + total > png.length) break;
    const type = String.fromCharCode(png[off + 4]!, png[off + 5]!, png[off + 6]!, png[off + 7]!);
    if (type === 'pHYs' && len === 9 && png[off + 16] === 1) {
      const xPpm = dv.getUint32(off + 8, false);
      const yPpm = dv.getUint32(off + 12, false);
      return {
        xDpi: Math.round(xPpm * METERS_PER_INCH),
        yDpi: Math.round(yPpm * METERS_PER_INCH),
      };
    }
    if (type === 'IEND') break;
    off += total;
  }
  return null;
}

/**
 * Pad a valid JPEG up to targetBytes using harmless COM (0xFFFE) segments
 * immediately before EOI (0xFFD9) without changing image pixels.
 * Requires targetBytes - jpeg.length >= 4 (minimum COM segment size).
 */
export function padJpegWithCom(jpeg: Uint8Array, targetBytes: number): Uint8Array {
  if (!isJpeg(jpeg) || jpeg.length < 4) return jpeg;
  const needed = Math.floor(targetBytes) - jpeg.length;
  if (needed < 4) return jpeg;

  // Locate final EOI (FF D9)
  let eoi = jpeg.length - 2;
  while (eoi >= 2 && !(jpeg[eoi] === 0xff && jpeg[eoi + 1] === 0xd9)) {
    eoi--;
  }
  if (eoi < 2) return jpeg;

  const chunks: Uint8Array[] = [];
  let remaining = needed;
  while (remaining > 0) {
    let segTotal = Math.min(65535, remaining);
    if (remaining - segTotal > 0 && remaining - segTotal < 4) {
      segTotal = remaining - 4;
    }
    const segLenField = segTotal - 2; // includes the 2-byte length field
    const seg = new Uint8Array(segTotal);
    seg[0] = 0xff;
    seg[1] = 0xfe;
    seg[2] = (segLenField >> 8) & 0xff;
    seg[3] = segLenField & 0xff;
    // Remaining payload bytes stay zero-filled (or harmless spaces)
    chunks.push(seg);
    remaining -= segTotal;
  }

  const totalInserted = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(jpeg.length + totalInserted);
  out.set(jpeg.subarray(0, eoi), 0);
  let cursor = eoi;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(jpeg.subarray(eoi), cursor);
  return out;
}
