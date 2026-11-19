import type { OutputFormat, Spec } from './types';

/** Case-insensitive search across preset titles, labels, tags, backgrounds, and KB caps. */
export function filterSpecs(specs: readonly Spec[], query: string): Spec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...specs];

  const terms = q.split(/\s+/).filter(Boolean);
  return specs.filter((spec) => {
    const haystack = [
      spec.id,
      spec.title,
      spec.shortLabel ?? '',
      spec.region,
      ...(spec.tags ?? []),
      spec.backgroundHint ?? '',
      `${spec.output.width}x${spec.output.height}`,
      spec.output.fileSizeKb.max !== null ? `${spec.output.fileSizeKb.max}kb` : '',
      spec.output.fileSizeKb.min !== null ? `${spec.output.fileSizeKb.min}kb` : '',
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

/** Find a published preset by ID (case-insensitive). */
export function findSpecById(specs: readonly Spec[], id: string | null | undefined): Spec | null {
  if (!id) return null;
  const target = id.trim().toLowerCase();
  return specs.find((s) => s.id.toLowerCase() === target) ?? null;
}

/** Generate a clean, human-readable filename such as NYSC-photo-12KB.jpg. */
export function buildDownloadFilename(
  spec: Spec,
  outputBytes: number,
  format: OutputFormat = spec.output.format,
): string {
  const rawBase = spec.shortLabel || spec.title || 'KiloCrop';
  const slug = rawBase
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const kb = Math.max(1, Math.round(outputBytes / 1024));
  const ext = format === 'png' ? 'png' : 'jpg';
  return `${slug || 'KiloCrop'}-photo-${kb}KB.${ext}`;
}
