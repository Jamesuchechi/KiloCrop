import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  buildRecipeQuery,
  parsePortalRule,
  parseQueryFit,
  parseQuerySpec,
  parseRecipeQuery,
  toQuerySpec,
} from './rule-parser';

interface CorpusCase {
  input: string;
  units: 'px' | 'mm';
  width: number;
  height: number;
  minKb: number | null;
  maxKb: number | null;
  format?: 'jpeg' | 'png';
  dpi?: number | null;
}

const NIGERIAN_AND_GLOBAL_CORPUS: CorpusCase[] = [
  {
    input: 'Passport must be JPG, max 25KB, 300x300px',
    units: 'px',
    width: 300,
    height: 300,
    minKb: null,
    maxKb: 25,
  },
  {
    input: 'Photo size between 20 KB and 50 KB, 3.5x4.5cm',
    units: 'mm',
    width: 35,
    height: 45,
    minKb: 20,
    maxKb: 50,
  },
  {
    input: 'Image dimensions must be 600 x 800 pixels and less than 2MB',
    units: 'px',
    width: 600,
    height: 800,
    minKb: null,
    maxKb: 2048,
  },
  {
    input: 'UNILORIN: minimum 600x600px, not more than 25kb, red background, 200 dpi',
    units: 'px',
    width: 600,
    height: 600,
    minKb: null,
    maxKb: 25,
    dpi: 200,
  },
  {
    input: 'Upload JPEG photo 200x200 px, size 7KB - 15KB, white background',
    units: 'px',
    width: 200,
    height: 200,
    minKb: 7,
    maxKb: 15,
  },
  {
    input: 'Invalid photo: file size must be between 5KB to 30KB, 275*314 px',
    units: 'px',
    width: 275,
    height: 314,
    minKb: 5,
    maxKb: 30,
  },
  {
    input: 'Photo should be 35mm x 45mm at 300 DPI, under 200 KB',
    units: 'mm',
    width: 35,
    height: 45,
    minKb: null,
    maxKb: 200,
    dpi: 300,
  },
  {
    input: '2x2 inch passport photo, max 240 kB, plain white background',
    units: 'mm',
    width: 50.8,
    height: 50.8,
    minKb: null,
    maxKb: 240,
  },
  {
    input:
      'Error: Image width must be 360px and height 400px, max size 50 kilobytes, light sky-blue background',
    units: 'px',
    width: 360,
    height: 400,
    minKb: null,
    maxKb: 50,
  },
  {
    input: 'At least 600x750 pixels, file size 50KB to 10MB',
    units: 'px',
    width: 600,
    height: 750,
    minKb: 50,
    maxKb: 10240,
  },
  {
    input: 'Width: 413px, Height: 531px, Maximum file size: 100 KB',
    units: 'px',
    width: 413,
    height: 531,
    minKb: null,
    maxKb: 100,
  },
  {
    input: 'Square passport 600×600, max 240 KB',
    units: 'px',
    width: 600,
    height: 600,
    minKb: null,
    maxKb: 240,
  },
  {
    input: 'LASU upload failed: JPEG must not exceed 20KB, 300x300px',
    units: 'px',
    width: 300,
    height: 300,
    minKb: null,
    maxKb: 20,
  },
  {
    input: 'Signature scan 140x60px, 10-20KB PNG',
    units: 'px',
    width: 140,
    height: 60,
    minKb: 10,
    maxKb: 20,
    format: 'png',
  },
  {
    input: 'FCSC portal: 35 x 45 mm, 300 dpi, 20 KB - 60 KB',
    units: 'mm',
    width: 35,
    height: 45,
    minKb: 20,
    maxKb: 60,
    dpi: 300,
  },
  {
    input: 'UNN screening: photo 400x400 px, under 40KB',
    units: 'px',
    width: 400,
    height: 400,
    minKb: null,
    maxKb: 40,
  },
  {
    input: 'UNILAG student ID: 450x450px, maximum 150 KB, pure white background',
    units: 'px',
    width: 450,
    height: 450,
    minKb: null,
    maxKb: 150,
  },
  {
    input: 'Canada IRCC: 420 x 540 pixels, max 4 MB',
    units: 'px',
    width: 420,
    height: 540,
    minKb: null,
    maxKb: 4096,
  },
  {
    input: 'PTDF scholarship: 600x800px, below 200KB',
    units: 'px',
    width: 600,
    height: 800,
    minKb: null,
    maxKb: 200,
  },
  {
    input: 'NELFUND passport photo: 500x500 pixels, up to 500 KB',
    units: 'px',
    width: 500,
    height: 500,
    minKb: null,
    maxKb: 500,
  },
  {
    input: 'File exceeds 30 KB limit. Required dimensions: 250x300 px',
    units: 'px',
    width: 250,
    height: 300,
    minKb: null,
    maxKb: 30,
  },
  {
    input: 'NYSC correction: 200 x 200, min 7 KB max 15 KB',
    units: 'px',
    width: 200,
    height: 200,
    minKb: 7,
    maxKb: 15,
  },
  {
    input: 'Passport photo 160x200px under 25 KB JPEG',
    units: 'px',
    width: 160,
    height: 200,
    minKb: null,
    maxKb: 25,
  },
  {
    input: 'Please upload a 1,200 x 1,200 px photo under 240 KB',
    units: 'px',
    width: 1200,
    height: 1200,
    minKb: null,
    maxKb: 240,
  },
  {
    input: 'Headshot: 320 x 400 pixels, file size 15-80 KB',
    units: 'px',
    width: 320,
    height: 400,
    minKb: 15,
    maxKb: 80,
  },
  {
    input: 'Visa photo 51 x 51 mm at 300dpi, max 240kb',
    units: 'mm',
    width: 51,
    height: 51,
    minKb: null,
    maxKb: 240,
    dpi: 300,
  },
  {
    input: 'School portal: width 300px height 350px, 35KB',
    units: 'px',
    width: 300,
    height: 350,
    minKb: null,
    maxKb: 35,
  },
  {
    input: 'Job form error: image must be 480x640px and less than 120 KB',
    units: 'px',
    width: 480,
    height: 640,
    minKb: null,
    maxKb: 120,
  },
  {
    input: 'Photo 150x180 pixels, 10 KB to 25 KB, JPG only',
    units: 'px',
    width: 150,
    height: 180,
    minKb: 10,
    maxKb: 25,
  },
  {
    input: 'Document scan 800x1100px, max 150KB PNG',
    units: 'px',
    width: 800,
    height: 1100,
    minKb: null,
    maxKb: 150,
    format: 'png',
  },
];

describe('rule-parser', () => {
  it('achieves >= 90% accuracy across 30 real Nigerian and global portal rule snippets', () => {
    let passed = 0;
    const failures: string[] = [];

    for (const c of NIGERIAN_AND_GLOBAL_CORPUS) {
      const { spec } = parsePortalRule(c.input);
      const ok =
        spec.output.units === c.units &&
        Math.abs(spec.output.width - c.width) < 0.1 &&
        Math.abs(spec.output.height - c.height) < 0.1 &&
        spec.output.fileSizeKb.min === c.minKb &&
        spec.output.fileSizeKb.max === c.maxKb &&
        (c.format === undefined || spec.output.format === c.format) &&
        (c.dpi === undefined || spec.output.dpi === c.dpi);

      if (ok) passed++;
      else failures.push(`${c.input} -> got ${JSON.stringify(spec.output)}`);
    }

    expect(failures).toEqual([]);
    expect(passed / NIGERIAN_AND_GLOBAL_CORPUS.length).toBeGreaterThanOrEqual(0.9);
  });

  it('sanitizes XSS payloads and clamps extreme numbers in parseQuerySpec', () => {
    const malicious =
      '?n=%3Cscript%3Ealert(1)%3C%2Fscript%3EUNILAG&w=999999&h=10&u=px&min=90&max=25';
    const spec = parseQuerySpec(malicious);

    expect(spec).not.toBeNull();
    expect(spec!.title).not.toContain('<');
    expect(spec!.title).not.toContain('>');
    expect(spec!.output.width).toBe(4000);
    expect(spec!.output.height).toBe(50);
    expect(spec!.output.fileSizeKb.max).toBe(25);
    expect(spec!.output.fileSizeKb.min).toBeNull();
    expect(spec!.provenance.kind).toBe('shared-query');
    expect(spec!.provenance.notes).toBe('Shared custom rule — confirm on portal');
  });

  it('returns null when w or h query params are missing or non-positive', () => {
    expect(parseQuerySpec('')).toBeNull();
    expect(parseQuerySpec('?n=Test&w=0&h=300')).toBeNull();
    expect(parseQuerySpec('?n=Test&w=abc&h=300')).toBeNull();
  });

  it('supports webp rules and single-edge/pad recipe query links safely', () => {
    const webpParsed = parsePortalRule('Cover photo 1200x630px under 90KB WebP');
    expect(webpParsed.spec.output.format).toBe('webp');
    expect(webpParsed.spec.output.fileSizeKb.max).toBe(90);

    const q = buildRecipeQuery({
      title: 'Email Header <script>',
      width: 600,
      height: null,
      fit: 'pad',
      format: 'webp',
      minKb: null,
      maxKb: 80,
      dpi: null,
    });
    expect(parseQueryFit(q)).toBe('pad');
    const rec = parseRecipeQuery(q);
    expect(rec).toMatchObject({
      title: 'Email Header script',
      width: 600,
      height: null,
      fit: 'pad',
      format: 'webp',
      maxKb: 80,
    });
  });

  it('property: toQuerySpec -> parseQuerySpec preserves clamped bounds cleanly', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 50, max: 2000 }),
        fc.integer({ min: 50, max: 2000 }),
        fc.integer({ min: 10, max: 500 }),
        (title, w, h, max) => {
          const min = Math.max(1, Math.floor(max / 2));
          const parsed = parsePortalRule(`${w}x${h}px ${min}KB-${max}KB`);
          parsed.spec.title = title;
          const query = toQuerySpec(parsed.spec);
          const roundTrip = parseQuerySpec(query);
          expect(roundTrip).not.toBeNull();
          expect(roundTrip!.output.width).toBe(w);
          expect(roundTrip!.output.height).toBe(h);
          expect(roundTrip!.output.fileSizeKb.min).toBe(min);
          expect(roundTrip!.output.fileSizeKb.max).toBe(max);
        },
      ),
    );
  });
});
