export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
  lastModified?: Date;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** Standard IEEE 802.3 CRC-32 checksum. */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function sanitizeZipPath(rawName: string): string {
  const cleaned = rawName
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .join('/');
  return cleaned || 'file';
}

function makeUniqueName(rawName: string, seen: Map<string, number>): string {
  const safe = sanitizeZipPath(rawName);
  const key = safe.toLowerCase();
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (count === 0) return safe;

  const dotIdx = safe.lastIndexOf('.');
  const suffix = `-${count + 1}`;
  if (dotIdx > safe.lastIndexOf('/') && dotIdx > 0) {
    return `${safe.slice(0, dotIdx)}${suffix}${safe.slice(dotIdx)}`;
  }
  return `${safe}${suffix}`;
}

interface PreparedEntry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  dosTime: number;
  dosDate: number;
  localOffset: number;
}

/** Build a standard PKZIP archive using compression method 0 (STORE). */
export function buildStoredZip(entries: readonly ZipEntryInput[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const seenNames = new Map<string, number>();
  const prepared: PreparedEntry[] = [];

  let localTotal = 0;
  let centralTotal = 0;

  for (const entry of entries) {
    const uniqueName = makeUniqueName(entry.name, seenNames);
    const nameBytes = encoder.encode(uniqueName);
    const { dosTime, dosDate } = toDosTimeDate(entry.lastModified ?? new Date());
    const crc = crc32(entry.data);

    prepared.push({
      nameBytes,
      data: entry.data,
      crc,
      dosTime,
      dosDate,
      localOffset: localTotal,
    });

    localTotal += 30 + nameBytes.length + entry.data.length;
    centralTotal += 46 + nameBytes.length;
  }

  const eocdSize = 22;
  const totalBytes = localTotal + centralTotal + eocdSize;
  const out = new Uint8Array(new ArrayBuffer(totalBytes));
  const dv = new DataView(out.buffer);

  let pos = 0;
  for (const item of prepared) {
    dv.setUint32(pos, 0x04034b50, true);
    dv.setUint16(pos + 4, 20, true);
    dv.setUint16(pos + 6, 0x0800, true);
    dv.setUint16(pos + 8, 0, true);
    dv.setUint16(pos + 10, item.dosTime, true);
    dv.setUint16(pos + 12, item.dosDate, true);
    dv.setUint32(pos + 14, item.crc, true);
    dv.setUint32(pos + 18, item.data.length, true);
    dv.setUint32(pos + 22, item.data.length, true);
    dv.setUint16(pos + 26, item.nameBytes.length, true);
    dv.setUint16(pos + 28, 0, true);
    pos += 30;

    out.set(item.nameBytes, pos);
    pos += item.nameBytes.length;
    out.set(item.data, pos);
    pos += item.data.length;
  }

  const centralOffset = pos;
  for (const item of prepared) {
    dv.setUint32(pos, 0x02014b50, true);
    dv.setUint16(pos + 4, 20, true);
    dv.setUint16(pos + 6, 20, true);
    dv.setUint16(pos + 8, 0x0800, true);
    dv.setUint16(pos + 10, 0, true);
    dv.setUint16(pos + 12, item.dosTime, true);
    dv.setUint16(pos + 14, item.dosDate, true);
    dv.setUint32(pos + 16, item.crc, true);
    dv.setUint32(pos + 20, item.data.length, true);
    dv.setUint32(pos + 24, item.data.length, true);
    dv.setUint16(pos + 28, item.nameBytes.length, true);
    dv.setUint16(pos + 30, 0, true);
    dv.setUint16(pos + 32, 0, true);
    dv.setUint16(pos + 34, 0, true);
    dv.setUint16(pos + 36, 0, true);
    dv.setUint32(pos + 38, 0, true);
    dv.setUint32(pos + 42, item.localOffset, true);
    pos += 46;

    out.set(item.nameBytes, pos);
    pos += item.nameBytes.length;
  }

  dv.setUint32(pos, 0x06054b50, true);
  dv.setUint16(pos + 4, 0, true);
  dv.setUint16(pos + 6, 0, true);
  dv.setUint16(pos + 8, prepared.length, true);
  dv.setUint16(pos + 10, prepared.length, true);
  dv.setUint32(pos + 12, centralTotal, true);
  dv.setUint32(pos + 16, centralOffset, true);
  dv.setUint16(pos + 20, 0, true);

  return out;
}

/** Package entries into a ZIP Blob using STORE (zero re-compression overhead). */
export function createZipBlob(entries: readonly ZipEntryInput[]): Blob {
  return new Blob([buildStoredZip(entries)], { type: 'application/zip' });
}
