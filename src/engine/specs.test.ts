import { describe, expect, it } from 'vitest';

import bundle from '../../specs/bundle.json';
import { buildDownloadFilename, filterSpecs, findSpecById } from './specs';
import type { Spec } from './types';

const specs = bundle as Spec[];

describe('specs registry & search', () => {
  it('loads 9 published presets (excluding draft template)', () => {
    expect(specs.length).toBe(9);
    expect(specs.some((s) => s.status === 'draft')).toBe(false);
    expect(specs.some((s) => s.id === 'ng-nis-passport-online')).toBe(true);
    expect(specs.some((s) => s.id === 'us-visa-ds160')).toBe(true);
  });

  it('filters by portal name, background colour, and KB cap', () => {
    expect(filterSpecs(specs, 'nysc').map((s) => s.id)).toContain('ng-nysc-portal');
    expect(filterSpecs(specs, '25kb').map((s) => s.id)).toContain('ng-unilorin-post-utme');
    expect(filterSpecs(specs, 'sky-blue').map((s) => s.id)).toContain('ng-oau-post-utme');
    expect(filterSpecs(specs, 'visa').map((s) => s.id)).toContain('us-visa-ds160');
  });

  it('finds spec by id cleanly', () => {
    expect(findSpecById(specs, 'ng-nysc-portal')?.shortLabel).toBe('NYSC');
    expect(findSpecById(specs, 'missing-spec')).toBeNull();
  });

  it('builds readable neutral filenames with KB and strict .jpg extension', () => {
    const nysc = findSpecById(specs, 'ng-nysc-portal')!;
    expect(buildDownloadFilename(nysc, 12 * 1024)).toBe('NYSC-photo-12KB.jpg');

    const nis = findSpecById(specs, 'ng-nis-passport-online')!;
    expect(buildDownloadFilename(nis, 184 * 1024)).toBe('NIS-Passport-photo-184KB.jpg');
  });
});
