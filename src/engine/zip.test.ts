import { describe, expect, it } from 'vitest';

import { buildStoredZip, crc32, createZipBlob } from './zip';

interface ParsedZipEntry {
  name: string;
  crc: number;
  size: number;
  method: number;
  payload: Uint8Array;
}

function parseStoredZip(bytes: Uint8Array): ParsedZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  const eocdOffset = bytes.length - 22;
  expect(dv.getUint32(eocdOffset, true)).toBe(0x06054b50);
  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);

  const out: ParsedZipEntry[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    expect(dv.getUint32(cursor, true)).toBe(0x02014b50);
    const method = dv.getUint16(cursor + 10, true);
    const crc = dv.getUint32(cursor + 16, true);
    const compSize = dv.getUint32(cursor + 20, true);
    const uncompSize = dv.getUint32(cursor + 24, true);
    expect(compSize).toBe(uncompSize);
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const localOffset = dv.getUint32(cursor + 42, true);
    const cdName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    expect(dv.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const localName = decoder.decode(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen),
    );
    expect(localName).toBe(cdName);

    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const payload = bytes.subarray(dataStart, dataStart + uncompSize);
    out.push({ name: cdName, crc, size: uncompSize, method, payload });
  }

  return out;
}

describe('zip', () => {
  it('computes standard IEEE 802.3 CRC-32 check value', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it('builds valid empty archive with 22-byte EOCD record', () => {
    const zip = buildStoredZip([]);
    expect(zip.byteLength).toBe(22);
    expect(parseStoredZip(zip)).toEqual([]);
  });

  it('packs UTF-8 files with STORE method, CRC verification, and duplicate-name deduplication', async () => {
    const enc = new TextEncoder();
    const first = enc.encode('hello world');
    const second = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const third = enc.encode('nested file payload');

    const bytes = buildStoredZip([
      { name: 'photo.jpg', data: first, lastModified: new Date('2026-03-10T14:20:10Z') },
      { name: '../photo.jpg', data: second },
      { name: 'résumé/doc-1.png', data: third },
    ]);

    const parsed = parseStoredZip(bytes);
    expect(parsed.map((p) => p.name)).toEqual(['photo.jpg', 'photo-2.jpg', 'résumé/doc-1.png']);
    expect(parsed[0]?.method).toBe(0);
    expect(parsed[0]?.crc).toBe(crc32(first));
    expect(Array.from(parsed[0]!.payload)).toEqual(Array.from(first));
    expect(Array.from(parsed[1]!.payload)).toEqual(Array.from(second));
    expect(Array.from(parsed[2]!.payload)).toEqual(Array.from(third));

    const blob = createZipBlob([{ name: 'a.txt', data: first }]);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(first.length);
  });
});
