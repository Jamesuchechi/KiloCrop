import { useMemo, useState } from 'preact/hooks';

import { resolveOutputDimensions } from '../engine/geometry';
import { filterSpecs } from '../engine/specs';
import type { OutputFormat, Spec, Units } from '../engine/types';

export interface PortalPickerProps {
  specs: readonly Spec[];
  activeSpec: Spec;
  mode: 'presets' | 'paste';
  querySharedSpec: Spec | null;
  ruleText: string;
  parsedSummary: { matchedFields: string[]; confidence: string; warnings: string[] } | null;
  onModeChange: (mode: 'presets' | 'paste') => void;
  onSelectSpec: (spec: Spec) => void;
  onClearSharedQuery: () => void;
  onRuleTextChange: (text: string) => void;
  onUpdateActiveSpec: (spec: Spec) => void;
  onPickFile: (file: File) => void;
}

const RULE_EXAMPLES = [
  'UNILORIN: 600x600px, max 25KB',
  'NYSC: 200x200px, 7-15KB',
  '35x45mm 300DPI, max 200KB',
];

function getBgKind(hint: string | null | undefined): 'white' | 'red' | 'blue' {
  const h = (hint ?? '').toLowerCase();
  if (/\b(sky[- ]blue|blue)\b/.test(h)) return 'blue';
  if (/\bred\b/.test(h)) return 'red';
  return 'white';
}

function getBgSwatchClass(hint: string | null | undefined): string {
  const kind = getBgKind(hint);
  if (kind === 'blue') return 'swatch swatch-blue';
  if (kind === 'red') return 'swatch swatch-red';
  return 'swatch swatch-white';
}

function getFrameAspectClass(width: number, height: number): string {
  const aspect = width / height;
  if (aspect < 0.8) return 'frame-portrait-34';
  if (aspect < 0.94) return 'frame-portrait-45';
  if (aspect <= 1.06) return 'frame-square';
  return 'frame-landscape';
}

function getFrameBgClass(hint: string | null | undefined): string {
  const kind = getBgKind(hint);
  if (kind === 'red') return 'frame-bg-red';
  if (kind === 'blue') return 'frame-bg-blue';
  return 'frame-bg-white';
}

function formatSizeValue(kb: number): string {
  if (kb >= 1024) {
    const mb = kb / 1024;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${kb} KB`;
}

function formatKbWindow(spec: Spec): string {
  const { min, max } = spec.output.fileSizeKb;
  if (min !== null && max !== null) {
    if (max >= 1024) return `${formatSizeValue(min)}–${formatSizeValue(max)}`;
    return `${min}–${max} KB`;
  }
  if (max !== null) return `≤ ${formatSizeValue(max)}`;
  if (min !== null) return `≥ ${formatSizeValue(min)}`;
  return 'No KB cap';
}

export function PortalPicker(props: PortalPickerProps) {
  const {
    specs,
    activeSpec,
    mode,
    querySharedSpec,
    ruleText,
    parsedSummary,
    onModeChange,
    onSelectSpec,
    onClearSharedQuery,
    onRuleTextChange,
    onUpdateActiveSpec,
    onPickFile,
  } = props;

  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);

  const filteredSpecs = useMemo(() => filterSpecs(specs, search), [specs, search]);
  const resolved = useMemo(() => resolveOutputDimensions(activeSpec), [activeSpec]);

  function updateOutput(patch: Partial<Spec['output']>) {
    onUpdateActiveSpec({
      ...activeSpec,
      output: {
        ...activeSpec.output,
        ...patch,
      },
    });
  }

  function updateKb(which: 'min' | 'max', raw: string) {
    const trimmed = raw.trim();
    const num = trimmed === '' ? null : Math.max(1, Math.round(Number(trimmed)));
    const val = num !== null && Number.isFinite(num) ? num : null;
    updateOutput({
      fileSizeKb: {
        ...activeSpec.output.fileSizeKb,
        [which]: val,
      },
    });
  }

  const frameClass = `spec-frame ${getFrameAspectClass(resolved.width, resolved.height)} ${getFrameBgClass(activeSpec.backgroundHint)}`;

  return (
    <section class="workbench">
      <div class="card stage-card stack">
        <div class="stage-head">
          <span class="stage-title">Target Spec Preview</span>
          <span>{activeSpec.shortLabel ?? activeSpec.region}</span>
        </div>

        <div class="stage-well">
          <div class={frameClass} aria-hidden="true">
            <div class="frame-reticle" />
            <svg class="frame-silhouette" viewBox="0 0 120 140" fill="currentColor">
              <circle cx="60" cy="48" r="24" />
              <path d="M16 140c0-26 20-44 44-44s44 18 44 44H16z" />
            </svg>
          </div>

          <div class="stage-pills">
            <span class="stage-pill">
              {resolved.width}×{resolved.height} px
            </span>
            <span class="stage-pill">{formatKbWindow(activeSpec)}</span>
            <span class="stage-pill">{activeSpec.output.format.toUpperCase()}</span>
          </div>
        </div>

        <div
          class={dragging ? 'stage-dropzone dragging' : 'stage-dropzone'}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer?.files?.[0];
            if (dropped) onPickFile(dropped);
          }}
        >
          <label class="btn btn-primary file-btn">
            Choose photo from phone / files
            <input
              type="file"
              accept="image/*"
              class="sr-only"
              onChange={(e) => {
                const picked = (e.target as HTMLInputElement).files?.[0];
                if (picked) onPickFile(picked);
              }}
            />
          </label>
          <p class="stage-note">
            Or drop a photo here · Cropped &amp; compressed offline on your device
          </p>
        </div>
      </div>

      <div class="card stack">
        {querySharedSpec && (
          <div class="banner banner-warn">
            <div>
              <strong>Shared custom rule ({querySharedSpec.title})</strong> — confirm limits on the
              actual portal before submitting.
            </div>
            <button type="button" class="btn-link" onClick={onClearSharedQuery}>
              Switch to presets
            </button>
          </div>
        )}

        <div class="tabs" role="tablist" aria-label="Choose setup method">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'presets'}
            class={mode === 'presets' ? 'tab active' : 'tab'}
            onClick={() => onModeChange('presets')}
          >
            Pick your portal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'paste'}
            class={mode === 'paste' ? 'tab active' : 'tab'}
            onClick={() => onModeChange('paste')}
          >
            Paste rule / Custom
          </button>
        </div>

        {mode === 'presets' ? (
          <div class="stack-sm">
            <label class="field-label" for="portal-search">
              Search portals (e.g. NYSC, 25KB, UNILORIN, visa, red)
            </label>
            <input
              id="portal-search"
              type="search"
              class="input"
              value={search}
              placeholder="Type portal name, KB limit, or country…"
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            />

            <div class="preset-grid" role="group" aria-label="Portal presets">
              {filteredSpecs.map((spec) => {
                const selected = spec.id === activeSpec.id;
                const dims = resolveOutputDimensions(spec);
                return (
                  <button
                    key={spec.id}
                    type="button"
                    aria-pressed={selected}
                    class={selected ? 'preset-tile active' : 'preset-tile'}
                    onClick={() => onSelectSpec(spec)}
                  >
                    <span class="preset-tile-top">
                      <span>{spec.shortLabel ?? spec.title}</span>
                      <span class={getBgSwatchClass(spec.backgroundHint)} aria-hidden="true" />
                    </span>
                    <span class="preset-tile-sub">
                      {dims.width}×{dims.height} · {formatKbWindow(spec)}
                    </span>
                  </button>
                );
              })}
              {filteredSpecs.length === 0 && (
                <p class="muted m-0">
                  No preset matched "{search}". Switch to <strong>Paste rule / Custom</strong> to
                  fit any portal.
                </p>
              )}
            </div>

            <div class="spec-card">
              <div class="spec-card-head">
                <strong>{activeSpec.title}</strong>
                {activeSpec.status === 'checked' && activeSpec.provenance.sourceUrl ? (
                  <a
                    class="badge badge-ok"
                    href={activeSpec.provenance.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Verified source ↗
                  </a>
                ) : (
                  <span class="badge badge-warn">Login portal — confirm limits</span>
                )}
              </div>

              <div class="spec-meta-row">
                <span>
                  <strong>Size:</strong> {resolved.width}×{resolved.height} px
                  {activeSpec.output.units === 'mm'
                    ? ` (${activeSpec.output.width}×${activeSpec.output.height} mm)`
                    : ''}
                </span>
                <span>
                  <strong>File:</strong> {formatKbWindow(activeSpec)} ·{' '}
                  {activeSpec.output.format.toUpperCase()}
                </span>
              </div>

              {activeSpec.backgroundHint && (
                <div class="bg-hint">
                  <span class={getBgSwatchClass(activeSpec.backgroundHint)} aria-hidden="true" />
                  <span>
                    <strong>Background needed:</strong> {activeSpec.backgroundHint}
                  </span>
                </div>
              )}

              {activeSpec.provenance.notes && (
                <p class="spec-note">{activeSpec.provenance.notes}</p>
              )}
            </div>
          </div>
        ) : (
          <div class="stack-sm">
            <label class="field-label" for="rule-text">
              Paste portal instruction or error message
            </label>
            <textarea
              id="rule-text"
              class="input textarea"
              rows={2}
              value={ruleText}
              placeholder="e.g. Passport must be JPG, max 25KB, 300x300px"
              onInput={(e) => onRuleTextChange((e.target as HTMLTextAreaElement).value)}
            />

            <div class="example-row" aria-label="Quick examples">
              {RULE_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  class="example-chip"
                  onClick={() => onRuleTextChange(example)}
                >
                  {example}
                </button>
              ))}
            </div>

            {parsedSummary && (
              <p class="muted m-0">
                Parsed ({parsedSummary.confidence}):{' '}
                {parsedSummary.matchedFields.length > 0
                  ? parsedSummary.matchedFields.join(', ')
                  : 'edit fields below'}
                {parsedSummary.warnings.length > 0 ? ` · ${parsedSummary.warnings.join(' ')}` : ''}
              </p>
            )}

            <div class="custom-grid">
              <label class="mini-field">
                <span>Width</span>
                <input
                  type="number"
                  class="input"
                  min={1}
                  step={activeSpec.output.units === 'mm' ? 0.5 : 1}
                  value={activeSpec.output.width}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    if (Number.isFinite(v) && v > 0) updateOutput({ width: v });
                  }}
                />
              </label>
              <label class="mini-field">
                <span>Height</span>
                <input
                  type="number"
                  class="input"
                  min={1}
                  step={activeSpec.output.units === 'mm' ? 0.5 : 1}
                  value={activeSpec.output.height}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    if (Number.isFinite(v) && v > 0) updateOutput({ height: v });
                  }}
                />
              </label>
              <label class="mini-field">
                <span>Units</span>
                <select
                  class="input"
                  value={activeSpec.output.units}
                  onChange={(e) => {
                    const u = (e.target as HTMLSelectElement).value as Units;
                    updateOutput({
                      units: u,
                      dpi: u === 'mm' ? (activeSpec.output.dpi ?? 300) : null,
                    });
                  }}
                >
                  <option value="px">px</option>
                  <option value="mm">mm</option>
                </select>
              </label>
              <label class="mini-field">
                <span>Min KB</span>
                <input
                  type="number"
                  class="input"
                  min={1}
                  placeholder="none"
                  value={activeSpec.output.fileSizeKb.min ?? ''}
                  onInput={(e) => updateKb('min', (e.target as HTMLInputElement).value)}
                />
              </label>
              <label class="mini-field">
                <span>Max KB</span>
                <input
                  type="number"
                  class="input"
                  min={1}
                  placeholder="none"
                  value={activeSpec.output.fileSizeKb.max ?? ''}
                  onInput={(e) => updateKb('max', (e.target as HTMLInputElement).value)}
                />
              </label>
              <label class="mini-field">
                <span>Format</span>
                <select
                  class="input"
                  value={activeSpec.output.format}
                  onChange={(e) =>
                    updateOutput({ format: (e.target as HTMLSelectElement).value as OutputFormat })
                  }
                >
                  <option value="jpeg">JPEG (.jpg)</option>
                  <option value="png">PNG</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
