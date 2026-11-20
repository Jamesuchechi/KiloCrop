import { sanitizeRuleLabel } from '../engine/rule-parser';
import type { FitMode, OutputFormat, PadBackdropStyle, SizePreset } from '../engine/types';

const STORAGE_KEY = 'kilocrop.savedPresets.v1';
const MAX_SAVED_PRESETS = 20;

export interface SavePresetInput {
  label: string;
  width: number | null;
  height: number | null;
  fit: FitMode;
  backdrop: PadBackdropStyle;
  format: OutputFormat;
  maxKb: number | null;
  autoContrast: boolean;
  sharpenPct: number;
}

function clampOptionalInt(val: unknown, min: number, max: number): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  const rounded = Math.round(val);
  if (rounded < min) return null;
  return Math.min(max, rounded);
}

function sanitizeFit(val: unknown): FitMode {
  if (val === 'inside' || val === 'fill' || val === 'pad' || val === 'stretch') return val;
  return 'inside';
}

function sanitizeBackdrop(val: unknown): PadBackdropStyle {
  if (val === 'blur' || val === 'edge' || val === 'white' || val === 'dark') return val;
  return 'blur';
}

function sanitizeFormat(val: unknown): OutputFormat {
  if (val === 'jpeg' || val === 'webp' || val === 'png') return val;
  return 'jpeg';
}

/** Load user-saved preset recipes from localStorage (metadata only, zero pixels). */
export function loadSavedPresets(): SizePreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const valid: SizePreset[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === 'string' && obj.id.startsWith('saved-') ? obj.id : null;
      if (!id) continue;
      valid.push({
        id,
        group: 'saved',
        label: sanitizeRuleLabel(
          typeof obj.label === 'string' ? obj.label : '',
          'Saved preset',
        ).slice(0, 40),
        width: clampOptionalInt(obj.width, 1, 8000),
        height: clampOptionalInt(obj.height, 1, 8000),
        fit: sanitizeFit(obj.fit),
        backdrop: sanitizeBackdrop(obj.backdrop),
        format: sanitizeFormat(obj.format),
        minKb: null,
        maxKb: clampOptionalInt(obj.maxKb, 1, 10240),
        dpi: null,
        autoContrast: typeof obj.autoContrast === 'boolean' ? obj.autoContrast : true,
        sharpenPct:
          typeof obj.sharpenPct === 'number' && Number.isFinite(obj.sharpenPct)
            ? Math.max(0, Math.min(100, Math.round(obj.sharpenPct)))
            : 35,
      });
      if (valid.length >= MAX_SAVED_PRESETS) break;
    }
    return valid;
  } catch {
    return [];
  }
}

function persistSavedPresets(list: SizePreset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED_PRESETS)));
  } catch {
    // Ignore quota/private-mode storage restrictions cleanly.
  }
}

export function saveCustomPreset(input: SavePresetInput): {
  list: SizePreset[];
  created: SizePreset;
} {
  const existing = loadSavedPresets();
  const cleanLabel = sanitizeRuleLabel(input.label, 'Custom Preset').slice(0, 40);
  const slug =
    cleanLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'preset';
  const id = `saved-${slug}-${Date.now().toString(36)}`;

  const created: SizePreset = {
    id,
    group: 'saved',
    label: cleanLabel,
    width: clampOptionalInt(input.width, 1, 8000),
    height: clampOptionalInt(input.height, 1, 8000),
    fit: sanitizeFit(input.fit),
    backdrop: sanitizeBackdrop(input.backdrop),
    format: sanitizeFormat(input.format),
    minKb: null,
    maxKb: clampOptionalInt(input.maxKb, 1, 10240),
    dpi: null,
    autoContrast: Boolean(input.autoContrast),
    sharpenPct: Math.max(0, Math.min(100, Math.round(input.sharpenPct))),
  };

  const next = [created, ...existing].slice(0, MAX_SAVED_PRESETS);
  persistSavedPresets(next);
  return { list: next, created };
}

export function deleteCustomPreset(id: string): SizePreset[] {
  const next = loadSavedPresets().filter((p) => p.id !== id);
  persistSavedPresets(next);
  return next;
}
