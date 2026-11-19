import type { OutputFormat, Spec, Units } from './types';

export type MatchedRuleField = 'dimensions' | 'minKb' | 'maxKb' | 'dpi' | 'format' | 'background';

export interface ParsedRuleResult {
  spec: Spec;
  matchedFields: MatchedRuleField[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

function toMmOrPx(value: number, unit: string | undefined): { value: number; units: Units } {
  const u = (unit ?? '').toLowerCase();
  if (u === 'cm') return { value: Number((value * 10).toFixed(2)), units: 'mm' };
  if (u === 'in' || u === 'inch' || u === 'inches' || u === '"') {
    return { value: Number((value * 25.4).toFixed(2)), units: 'mm' };
  }
  if (u === 'mm') return { value, units: 'mm' };
  return { value: Math.round(value), units: 'px' };
}

function sizeToKb(value: number, unit: string | undefined): number {
  const u = (unit ?? 'kb').toLowerCase();
  if (u.startsWith('mb') || u.startsWith('megabyte')) {
    return Math.round(value * 1024);
  }
  return Math.round(value);
}

function sanitizeLabel(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/[<>"'`]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'Shared Portal Rule';
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic parser for pasted Nigerian/global portal rules or rejection errors.
 * Produces an editable Spec with matched field telemetry.
 */
export function parsePortalRule(rawText: string): ParsedRuleResult {
  const normalized = rawText
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/[×*]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();

  const matchedFields: MatchedRuleField[] = [];
  const warnings: string[] = [];

  let units: Units = 'px';
  let width = 600;
  let height = 600;
  let dpi: number | null = null;
  let minKb: number | null = null;
  let maxKb: number | null = null;
  let format: OutputFormat = 'jpeg';
  let backgroundHint: string | null = null;

  // 1. Dimensions: pair like 600x800px, 35 x 45 mm, 3.5x4.5cm, 2x2 inch
  const pairRe =
    /(\d+(?:\.\d+)?)\s*(px|pixels?|mm|cm|inches?|in|")?\s*x\s*(\d+(?:\.\d+)?)\s*(px|pixels?|mm|cm|inches?|in|")?/i;
  const pairMatch = normalized.match(pairRe);
  if (pairMatch) {
    const n1 = Number(pairMatch[1]);
    const u1 = pairMatch[2];
    const n2 = Number(pairMatch[3]);
    const u2 = pairMatch[4];
    const effectiveUnit = u2 ?? u1;

    if (effectiveUnit) {
      const c1 = toMmOrPx(n1, u1 ?? effectiveUnit);
      const c2 = toMmOrPx(n2, u2 ?? effectiveUnit);
      units = c1.units;
      width = c1.value;
      height = c2.value;
      matchedFields.push('dimensions');
    } else if (n1 >= 40 && n2 >= 40) {
      units = 'px';
      width = Math.round(n1);
      height = Math.round(n2);
      matchedFields.push('dimensions');
    } else {
      warnings.push('Unitless small dimensions detected; confirm px vs cm/in.');
    }
  } else {
    const wMatch = normalized.match(
      /width\s*(?:of|is|:|=|must\s+be|at\s+least|min(?:imum)?)?\s*(\d+(?:\.\d+)?)\s*(px|pixels?|mm|cm|inches?|in)?/i,
    );
    const hMatch = normalized.match(
      /height\s*(?:of|is|:|=|must\s+be|at\s+least|min(?:imum)?)?\s*(\d+(?:\.\d+)?)\s*(px|pixels?|mm|cm|inches?|in)?/i,
    );
    if (wMatch && hMatch) {
      const u = wMatch[2] ?? hMatch[2] ?? 'px';
      const c1 = toMmOrPx(Number(wMatch[1]), u);
      const c2 = toMmOrPx(Number(hMatch[1]), u);
      units = c1.units;
      width = c1.value;
      height = c2.value;
      matchedFields.push('dimensions');
    }
  }

  // 2. DPI
  const dpiMatch =
    normalized.match(/(\d{2,4})\s*(?:dpi|ppi)/i) ??
    normalized.match(/(?:dpi|resolution)\s*[:=]?\s*(\d{2,4})/i);
  if (dpiMatch) {
    dpi = clampNum(Math.round(Number(dpiMatch[1])), 72, 600);
    matchedFields.push('dpi');
  }

  // 3. File size ranges ("7KB - 15KB", "between 20 KB and 50 KB", "50KB to 10MB")
  let sizeText = normalized;
  const rangeRe =
    /(?:between|from)?\s*(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)?\s*(?:-|–|to|and)\s*(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)\b/i;
  const rangeMatch = sizeText.match(rangeRe);
  if (rangeMatch) {
    const u2 = rangeMatch[4]!;
    const u1 = rangeMatch[2] ?? u2;
    minKb = sizeToKb(Number(rangeMatch[1]), u1);
    maxKb = sizeToKb(Number(rangeMatch[3]), u2);
    matchedFields.push('minKb', 'maxKb');
  } else {
    // Consume negated comparators first so "not more than" never hits "more than"
    const negMaxRe =
      /(?:not\s+(?:more|greater|exceed(?:ing)?)\s+than|must\s+not\s+exceed)\s*(?:file\s*size\s*(?:of|is|:)?\s*)?(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)\b/i;
    const negMax = sizeText.match(negMaxRe);
    if (negMax) {
      maxKb = sizeToKb(Number(negMax[1]), negMax[2]);
      matchedFields.push('maxKb');
      sizeText = sizeText.replace(negMax[0], ' ');
    }

    const negMinRe =
      /(?:not|no)\s+less\s+than\s*(?:file\s*size\s*(?:of|is|:)?\s*)?(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)\b/i;
    const negMin = sizeText.match(negMinRe);
    if (negMin) {
      minKb = sizeToKb(Number(negMin[1]), negMin[2]);
      matchedFields.push('minKb');
      sizeText = sizeText.replace(negMin[0], ' ');
    }

    if (maxKb === null) {
      const maxMatch = sizeText.match(
        /(?:max(?:imum)?|under|below|less\s+than|exceeds?|up\s+to|<=?)\s*(?:file\s*size\s*(?:of|is|:)?\s*)?(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)\b/i,
      );
      if (maxMatch) {
        maxKb = sizeToKb(Number(maxMatch[1]), maxMatch[2]);
        matchedFields.push('maxKb');
        sizeText = sizeText.replace(maxMatch[0], ' ');
      }
    }

    if (minKb === null) {
      const minMatch = sizeText.match(
        /(?:min(?:imum)?|at\s+least|>=?|above|more\s+than)\s*(?:file\s*size\s*(?:of|is|:)?\s*)?(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)\b/i,
      );
      if (minMatch) {
        minKb = sizeToKb(Number(minMatch[1]), minMatch[2]);
        matchedFields.push('minKb');
        sizeText = sizeText.replace(minMatch[0], ' ');
      }
    }

    if (minKb === null && maxKb === null) {
      const singleSize = sizeText.match(/\b(\d+(?:\.\d+)?)\s*(kb|kilobytes?|mb|megabytes?)\b/i);
      if (singleSize) {
        maxKb = sizeToKb(Number(singleSize[1]), singleSize[2]);
        matchedFields.push('maxKb');
      }
    }
  }

  if (minKb !== null && maxKb !== null && minKb > maxKb) {
    warnings.push('Parsed min KB exceeded max KB; cleared min KB.');
    minKb = null;
  }

  // 4. Format
  if (/\bpng\b/i.test(normalized) && !/\bjpe?g\b/i.test(normalized)) {
    format = 'png';
    matchedFields.push('format');
  } else if (/\bjpe?g\b/i.test(normalized)) {
    format = 'jpeg';
    matchedFields.push('format');
  }

  // 5. Background color hint
  const bgMatch = normalized.match(
    /\b(light\s+sky[- ]blue|sky[- ]blue|off[- ]white|pure\s+white|plain\s+white|white|red|blue)\b(?:\s+background|\s+bg|\s+backdrop)?/i,
  );
  if (bgMatch && /(background|backdrop|\bbg\b|white|red|blue)/i.test(normalized)) {
    backgroundHint = bgMatch[1]!.toLowerCase().replace(/\s+/g, ' ');
    matchedFields.push('background');
  }

  // Clamp dimensions safely
  if (units === 'px') {
    width = clampNum(Math.round(width), 50, 4000);
    height = clampNum(Math.round(height), 50, 4000);
  } else {
    width = clampNum(width, 10, 300);
    height = clampNum(height, 10, 300);
    if (!dpi) dpi = 300;
  }

  const hasDims = matchedFields.includes('dimensions');
  const hasSize = matchedFields.includes('maxKb') || matchedFields.includes('minKb');
  const confidence = hasDims && hasSize ? 'high' : hasDims || hasSize ? 'medium' : 'low';

  return {
    spec: {
      id: 'pasted-rule',
      schemaVersion: 1,
      title: 'Pasted portal rule',
      region: 'CUSTOM',
      status: 'draft',
      output: {
        units,
        width,
        height,
        dpi,
        format,
        fileSizeKb: { min: minKb, max: maxKb },
      },
      backgroundHint,
      provenance: {
        kind: 'pasted-rule',
        sourceUrl: null,
        archiveUrl: null,
        verifiedOn: null,
        notes: 'Parsed from pasted rule text — confirm against portal instructions.',
      },
    },
    matchedFields,
    confidence,
    warnings,
  };
}

/** Serialize any Spec into a clean plain-query share URL (?n=&w=&h=&min=&max=&u=px|mm). */
export function toQuerySpec(spec: Spec): string {
  const params = new URLSearchParams();
  params.set('n', sanitizeLabel(spec.title));
  params.set('w', String(spec.output.width));
  params.set('h', String(spec.output.height));
  params.set('u', spec.output.units);
  if (spec.output.dpi !== null) params.set('dpi', String(spec.output.dpi));
  if (spec.output.fileSizeKb.min !== null) params.set('min', String(spec.output.fileSizeKb.min));
  if (spec.output.fileSizeKb.max !== null) params.set('max', String(spec.output.fileSizeKb.max));
  if (spec.output.format !== 'jpeg') params.set('fmt', spec.output.format);
  return `?${params.toString()}`;
}

/** Parse and strictly sanitize a shareable plain-query portal URL (?n=&w=&h=&min=&max=&u=). */
export function parseQuerySpec(search: string): Spec | null {
  const cleanSearch = search.startsWith('?') ? search.slice(1) : search;
  if (!cleanSearch) return null;

  const params = new URLSearchParams(cleanSearch);
  const wRaw = Number(params.get('w'));
  const hRaw = Number(params.get('h'));
  if (!Number.isFinite(wRaw) || !Number.isFinite(hRaw) || wRaw <= 0 || hRaw <= 0) {
    return null;
  }

  const uParam = (params.get('u') ?? 'px').toLowerCase();
  const units: Units = uParam === 'mm' ? 'mm' : 'px';

  const width =
    units === 'px'
      ? clampNum(Math.round(wRaw), 50, 4000)
      : clampNum(Number(wRaw.toFixed(2)), 10, 300);
  const height =
    units === 'px'
      ? clampNum(Math.round(hRaw), 50, 4000)
      : clampNum(Number(hRaw.toFixed(2)), 10, 300);

  const dpiParam = params.get('dpi');
  let dpi: number | null = null;
  if (dpiParam !== null) {
    const parsedDpi = Number(dpiParam);
    if (Number.isFinite(parsedDpi) && parsedDpi > 0) {
      dpi = clampNum(Math.round(parsedDpi), 72, 600);
    }
  }
  if (units === 'mm' && dpi === null) dpi = 300;

  const minParam = params.get('min');
  const maxParam = params.get('max');
  let minKb: number | null = null;
  let maxKb: number | null = null;

  if (minParam !== null && minParam !== '') {
    const v = Number(minParam);
    if (Number.isFinite(v) && v > 0) minKb = clampNum(Math.round(v), 1, 10240);
  }
  if (maxParam !== null && maxParam !== '') {
    const v = Number(maxParam);
    if (Number.isFinite(v) && v > 0) maxKb = clampNum(Math.round(v), 1, 10240);
  }
  if (minKb !== null && maxKb !== null && minKb > maxKb) {
    minKb = null;
  }

  const fmtParam = (params.get('fmt') ?? 'jpeg').toLowerCase();
  const format: OutputFormat = fmtParam === 'png' ? 'png' : 'jpeg';

  return {
    id: 'shared-query',
    schemaVersion: 1,
    title: sanitizeLabel(params.get('n')),
    region: 'CUSTOM',
    status: 'draft',
    output: {
      units,
      width,
      height,
      dpi,
      format,
      fileSizeKb: { min: minKb, max: maxKb },
    },
    provenance: {
      kind: 'shared-query',
      sourceUrl: null,
      archiveUrl: null,
      verifiedOn: null,
      notes: 'Shared custom rule — confirm on portal',
    },
  };
}
