import { describe, expect, it } from 'vitest';

import {
  GENERAL_PRESETS,
  buildPresetCatalog,
  formatExtension,
  formatFileSize,
  formatOutputFilename,
  formatPresetOptionLabel,
} from './presets';
import type { Spec } from './types';

const SAMPLE_PORTAL_SPECS: Spec[] = [
  {
    id: 'ng-nysc-portal',
    schemaVersion: 1,
    title: 'NYSC Mobilization Portal',
    shortLabel: 'NYSC',
    region: 'NG',
    status: 'checked',
    output: {
      units: 'px',
      width: 200,
      height: 200,
      dpi: null,
      format: 'jpeg',
      fileSizeKb: { min: 7, max: 15 },
    },
    backgroundHint: 'plain white or light background',
    provenance: {
      kind: 'public-page',
      sourceUrl: 'https://portal.nysc.org.ng',
      archiveUrl: null,
      verifiedOn: '2026-11-18',
      notes: 'Confirm portrait crop.',
    },
  },
];

describe('presets', () => {
  it('merges general and portal presets without losing KB or DPI rules', () => {
    const catalog = buildPresetCatalog(SAMPLE_PORTAL_SPECS);
    expect(catalog.length).toBe(GENERAL_PRESETS.length + 1);
    const nysc = catalog.find((p) => p.id === 'ng-nysc-portal');
    expect(nysc).toMatchObject({
      group: 'portal',
      width: 200,
      height: 200,
      fit: 'fill',
      format: 'jpeg',
      minKb: 7,
      maxKb: 15,
    });
    expect(nysc?.note).toContain('plain white or light background');
    expect(formatPresetOptionLabel(nysc!)).toBe('NYSC – 200×200 (7–15 KB)');
  });

  it('formats general labels, byte readouts, extensions, and clean filenames', () => {
    expect(formatPresetOptionLabel(GENERAL_PRESETS[0]!)).toBe('Custom size');
    expect(formatPresetOptionLabel(GENERAL_PRESETS[9]!)).toBe('Email-safe width – 600×auto');

    expect(formatFileSize(0)).toEqual({ value: '0', unit: 'KB' });
    expect(formatFileSize(48 * 1024)).toEqual({ value: '48', unit: 'KB' });
    expect(formatFileSize(2.5 * 1024 * 1024)).toEqual({ value: '2.50', unit: 'MB' });

    expect(formatExtension('jpeg')).toBe('jpg');
    expect(formatExtension('webp')).toBe('webp');
    expect(formatExtension('png')).toBe('png');

    expect(formatOutputFilename('IMG_001 (1).jpeg', 1080, 1080, 'webp')).toBe(
      'IMG_001-1-kilocrop-1080x1080.webp',
    );
  });
});
