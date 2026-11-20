import { resolveOutputDimensions } from './geometry';
import type { OutputFormat, SizePreset, Spec } from './types';

export const GENERAL_PRESETS: readonly SizePreset[] = [
  {
    id: 'custom',
    group: 'general',
    label: 'Custom size',
    width: null,
    height: null,
    fit: 'inside',
  },
  {
    id: 'instagram-post',
    group: 'general',
    label: 'Instagram post',
    width: 1080,
    height: 1080,
    fit: 'fill',
  },
  {
    id: 'instagram-story',
    group: 'general',
    label: 'Instagram story',
    width: 1080,
    height: 1920,
    fit: 'fill',
  },
  {
    id: 'youtube-thumbnail',
    group: 'general',
    label: 'YouTube thumbnail',
    width: 1280,
    height: 720,
    fit: 'fill',
  },
  {
    id: 'og-image',
    group: 'general',
    label: 'Link preview (OG image)',
    width: 1200,
    height: 630,
    fit: 'fill',
  },
  {
    id: 'linkedin-banner',
    group: 'general',
    label: 'LinkedIn banner',
    width: 1584,
    height: 396,
    fit: 'fill',
  },
  {
    id: 'whatsapp-profile',
    group: 'general',
    label: 'WhatsApp profile',
    width: 640,
    height: 640,
    fit: 'fill',
  },
  {
    id: 'passport-35x45',
    group: 'general',
    label: 'Passport 35×45 mm',
    width: 413,
    height: 531,
    fit: 'fill',
    format: 'jpeg',
    dpi: 300,
  },
  { id: 'web-hero', group: 'general', label: 'Web hero', width: 1920, height: 1080, fit: 'fill' },
  {
    id: 'email-safe',
    group: 'general',
    label: 'Email-safe width',
    width: 600,
    height: null,
    fit: 'inside',
  },
  {
    id: 'app-icon',
    group: 'general',
    label: 'App icon / favicon',
    width: 512,
    height: 512,
    fit: 'fill',
  },
];

/** Combine common social/web presets with bundled portal ID & exam rules. */
export function buildPresetCatalog(portalSpecs: readonly Spec[]): SizePreset[] {
  const portalPresets: SizePreset[] = portalSpecs.map((spec) => {
    const dims = resolveOutputDimensions(spec);
    const noteParts: string[] = [];
    if (spec.backgroundHint) {
      noteParts.push(`Background required: ${spec.backgroundHint}.`);
    }
    if (spec.provenance.notes) {
      noteParts.push(spec.provenance.notes);
    }

    return {
      id: spec.id,
      group: 'portal',
      label: spec.shortLabel || spec.title,
      width: dims.width,
      height: dims.height,
      fit: 'fill',
      format: spec.output.format,
      minKb: spec.output.fileSizeKb.min,
      maxKb: spec.output.fileSizeKb.max,
      dpi: dims.dpi,
      backgroundHint: spec.backgroundHint ?? null,
      note: noteParts.length > 0 ? noteParts.join(' ') : null,
    };
  });

  return [...GENERAL_PRESETS, ...portalPresets];
}

export function formatPresetOptionLabel(preset: SizePreset): string {
  const hasDims = preset.width !== null || preset.height !== null;
  const dimsText = hasDims ? ` – ${preset.width ?? 'auto'}×${preset.height ?? 'auto'}` : '';
  const kbText =
    preset.minKb && preset.maxKb
      ? ` (${preset.minKb}–${preset.maxKb} KB)`
      : preset.maxKb
        ? ` (≤ ${preset.maxKb} KB)`
        : '';
  return `${preset.label}${dimsText}${kbText}`;
}

export function formatFileSize(bytes: number): { value: string; unit: 'KB' | 'MB' } {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { value: '0', unit: 'KB' };
  }
  if (bytes >= 1048576) {
    return { value: (bytes / 1048576).toFixed(2), unit: 'MB' };
  }
  return { value: String(Math.max(1, Math.round(bytes / 1024))), unit: 'KB' };
}

export function formatExtension(format: OutputFormat): 'jpg' | 'webp' | 'png' {
  if (format === 'webp') return 'webp';
  if (format === 'png') return 'png';
  return 'jpg';
}

export type PresetCategory = 'social' | 'web' | 'portal' | 'print' | 'saved';

export const PORTAL_GUIDE_SLUGS: Readonly<Record<string, string>> = {
  'ng-nis-passport-online': 'nigeria-passport-photo-online',
  'ng-nysc-portal': 'nysc-passport-photo-size',
  'ng-waec-gce': 'waec-gce-passport-photo',
  'ng-unilorin-post-utme': 'unilorin-post-utme-passport-photo',
  'ng-oau-post-utme': 'oau-post-utme-passport-photo',
  'ng-lasu-post-utme': 'lasu-screening-passport-photo',
  'us-visa-ds160': 'us-visa-ds160-photo-size',
  'uk-passport-digital': 'uk-digital-passport-photo',
};

const SOCIAL_PRESET_IDS = new Set([
  'instagram-post',
  'instagram-story',
  'youtube-thumbnail',
  'linkedin-banner',
  'whatsapp-profile',
]);

export function getPresetCategory(preset: SizePreset): PresetCategory {
  if (preset.group === 'saved') return 'saved';
  if (preset.group === 'portal') return 'portal';
  if (preset.id === 'passport-35x45') return 'print';
  if (SOCIAL_PRESET_IDS.has(preset.id)) return 'social';
  return 'web';
}

export function formatOutputFilename(
  baseName: string,
  width: number,
  height: number,
  format: OutputFormat,
): string {
  const cleanBase =
    baseName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image';
  return `${cleanBase}-kilocrop-${width}x${height}.${formatExtension(format)}`;
}
