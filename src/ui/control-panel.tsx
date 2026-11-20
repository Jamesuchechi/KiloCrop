import { useState } from 'preact/hooks';

import { formatExtension, formatFileSize, formatPresetOptionLabel } from '../engine/presets';
import type { FitMode, OutputFormat, PadBackdropStyle, SizePreset } from '../engine/types';
import {
  BookmarkIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FitCropIcon,
  FitInsideIcon,
  FitPadIcon,
  FitStretchIcon,
  LinkIcon,
  PasteIcon,
  RefreshIcon,
  TrashIcon,
} from './icons';

const FIT_OPTIONS: ReadonlyArray<{
  id: FitMode;
  label: string;
  title: string;
}> = [
  { id: 'inside', label: 'Inside', title: 'Fit inside, keep proportions' },
  { id: 'fill', label: 'Crop', title: 'Fill exact size, crop edges' },
  { id: 'pad', label: 'Pad', title: 'Keep whole image with matching backdrop' },
  { id: 'stretch', label: 'Stretch', title: 'Fill exact size, stretch' },
];

const BACKDROP_OPTIONS: ReadonlyArray<{
  id: PadBackdropStyle;
  label: string;
  swatchClass: string;
}> = [
  { id: 'blur', label: 'Blur', swatchClass: 'swatch-dot swatch-blur' },
  { id: 'edge', label: 'Edge', swatchClass: 'swatch-dot swatch-edge' },
  { id: 'white', label: 'White', swatchClass: 'swatch-dot swatch-white' },
  { id: 'dark', label: 'Dark', swatchClass: 'swatch-dot swatch-dark' },
];

const FORMAT_OPTIONS: ReadonlyArray<{
  id: OutputFormat;
  label: string;
  tag?: string;
}> = [
  { id: 'jpeg', label: 'JPEG' },
  { id: 'webp', label: 'WebP', tag: 'Smallest' },
  { id: 'png', label: 'PNG', tag: 'Lossless' },
];

const QUICK_KB_TARGETS = [25, 50, 100, 200] as const;

export interface ControlPanelProps {
  presets: readonly SizePreset[];
  activePresetId: string;
  widthStr: string;
  heightStr: string;
  fit: FitMode;
  backdrop: PadBackdropStyle;
  dontEnlarge: boolean;
  format: OutputFormat;
  maxKbStr: string;
  quality: number;
  autoContrast: boolean;
  sharpenPct: number;
  hasFile: boolean;
  canDownload: boolean;
  canCompare: boolean;
  resultMeta: { bytes: number; actualFormat: OutputFormat } | null;
  clipboardSupported: boolean;
  copiedImageFeedback: boolean;
  copiedLinkFeedback: boolean;
  onSelectPreset: (presetId: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onCopyRecipeLink: () => void;
  onApplyPastedRule: (ruleText: string) => string | null;
  onWidthChange: (val: string) => void;
  onHeightChange: (val: string) => void;
  onFitChange: (fit: FitMode) => void;
  onBackdropChange: (backdrop: PadBackdropStyle) => void;
  onDontEnlargeChange: (checked: boolean) => void;
  onFormatChange: (fmt: OutputFormat) => void;
  onMaxKbChange: (val: string) => void;
  onQualityChange: (q: number) => void;
  onAutoContrastChange: (checked: boolean) => void;
  onSharpenChange: (pct: number) => void;
  onDownload: () => void;
  onCopyImage: () => void;
  onCompareHold: (showOriginal: boolean) => void;
  onChooseAnother: () => void;
}

function renderFitIcon(mode: FitMode) {
  if (mode === 'inside') return <FitInsideIcon />;
  if (mode === 'fill') return <FitCropIcon />;
  if (mode === 'pad') return <FitPadIcon />;
  return <FitStretchIcon />;
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    presets,
    activePresetId,
    widthStr,
    heightStr,
    fit,
    backdrop,
    dontEnlarge,
    format,
    maxKbStr,
    quality,
    autoContrast,
    sharpenPct,
    hasFile,
    canDownload,
    canCompare,
    resultMeta,
    clipboardSupported,
    copiedImageFeedback,
    copiedLinkFeedback,
    onSelectPreset,
    onSavePreset,
    onDeletePreset,
    onCopyRecipeLink,
    onApplyPastedRule,
    onWidthChange,
    onHeightChange,
    onFitChange,
    onBackdropChange,
    onDontEnlargeChange,
    onFormatChange,
    onMaxKbChange,
    onQualityChange,
    onAutoContrastChange,
    onSharpenChange,
    onDownload,
    onCopyImage,
    onCompareHold,
    onChooseAnother,
  } = props;

  const [toolPanel, setToolPanel] = useState<'none' | 'save' | 'paste'>('none');
  const [presetNameInput, setPresetNameInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);

  const savedPresets = presets.filter((p) => p.group === 'saved');
  const generalPresets = presets.filter((p) => p.group === 'general');
  const portalPresets = presets.filter((p) => p.group === 'portal');
  const activeSaved = savedPresets.find((p) => p.id === activePresetId);

  const isPng = format === 'png';
  const maxKbNum = Number(maxKbStr);
  const hasMaxKb = maxKbStr.trim() !== '' && Number.isFinite(maxKbNum) && maxKbNum > 0;
  const qualityDisabled = isPng || hasMaxKb;

  const qualityHint = hasMaxKb
    ? `Quality tuned automatically to stay under ${maxKbNum} KB.`
    : isPng
      ? 'PNG is lossless. Set a max KB cap to shrink pixel size automatically.'
      : 'Add a max KB cap or dial quality manually.';

  const dlLabel =
    hasFile && resultMeta
      ? `Download ${formatExtension(resultMeta.actualFormat).toUpperCase()} · ${formatFileSize(resultMeta.bytes).value} ${formatFileSize(resultMeta.bytes).unit}`
      : 'Download image';

  function submitSavePreset(e: Event) {
    e.preventDefault();
    if (!presetNameInput.trim()) return;
    onSavePreset(presetNameInput.trim());
    setPresetNameInput('');
    setToolPanel('none');
  }

  function submitPasteRule(e: Event) {
    e.preventDefault();
    if (!pasteInput.trim()) return;
    const msg = onApplyPastedRule(pasteInput);
    setPasteFeedback(msg);
    if (!msg) {
      setToolPanel('none');
    }
  }

  return (
    <aside class="controls-panel" aria-label="Image resize and compression settings">
      <div class="inspector-scroll">
        <fieldset class="inspector-section">
          <legend class="section-heading">Destination</legend>

          <label class="field-block">
            <span class="field-caption">Preset</span>
            <select
              id="preset"
              class="inspector-select"
              value={activePresetId}
              onChange={(e) => onSelectPreset((e.target as HTMLSelectElement).value)}
            >
              {savedPresets.length > 0 && (
                <optgroup label="Saved presets">
                  {savedPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatPresetOptionLabel(p)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Common sizes">
                {generalPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPresetOptionLabel(p)}
                  </option>
                ))}
              </optgroup>
              {portalPresets.length > 0 && (
                <optgroup label="Portals & IDs">
                  {portalPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatPresetOptionLabel(p)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <div class="preset-tools">
            <button
              type="button"
              class={toolPanel === 'save' ? 'tool-chip active' : 'tool-chip'}
              aria-expanded={toolPanel === 'save'}
              onClick={() => setToolPanel((p) => (p === 'save' ? 'none' : 'save'))}
            >
              <BookmarkIcon />
              <span>Save preset</span>
            </button>
            <button type="button" class="tool-chip" onClick={onCopyRecipeLink}>
              {copiedLinkFeedback ? <CheckIcon /> : <LinkIcon />}
              <span>{copiedLinkFeedback ? 'Copied!' : 'Copy link'}</span>
            </button>
            <button
              type="button"
              class={toolPanel === 'paste' ? 'tool-chip active' : 'tool-chip'}
              aria-expanded={toolPanel === 'paste'}
              onClick={() => {
                setPasteFeedback(null);
                setToolPanel((p) => (p === 'paste' ? 'none' : 'paste'));
              }}
            >
              <PasteIcon />
              <span>Paste rule</span>
            </button>
            {activeSaved && (
              <button
                type="button"
                class="tool-chip tool-chip-danger"
                aria-label="Delete saved preset"
                onClick={() => onDeletePreset(activeSaved.id)}
              >
                <TrashIcon />
                <span>Delete</span>
              </button>
            )}
          </div>

          {toolPanel === 'save' && (
            <form class="inline-tool-form" onSubmit={submitSavePreset}>
              <input
                type="text"
                class="input"
                maxLength={40}
                placeholder="e.g. Blog cover 120KB"
                aria-label="Custom preset name"
                value={presetNameInput}
                onInput={(e) => setPresetNameInput((e.target as HTMLInputElement).value)}
              />
              <button type="submit" class="tool-submit">
                Save
              </button>
            </form>
          )}

          {toolPanel === 'paste' && (
            <form class="inline-tool-form" onSubmit={submitPasteRule}>
              <input
                type="text"
                class="input"
                placeholder="e.g. 600x600px, max 25KB"
                aria-label="Paste requirement text"
                value={pasteInput}
                onInput={(e) => setPasteInput((e.target as HTMLInputElement).value)}
              />
              <button type="submit" class="tool-submit">
                Apply
              </button>
            </form>
          )}
          {toolPanel === 'paste' && pasteFeedback && <p class="hint">{pasteFeedback}</p>}

          <div class="row">
            <label class="field-block">
              <span class="field-caption">Width</span>
              <div class="unit-input">
                <span class="unit-prefix" aria-hidden="true">
                  W
                </span>
                <input
                  type="number"
                  id="w"
                  min={1}
                  max={8000}
                  placeholder="auto"
                  inputMode="numeric"
                  value={widthStr}
                  onInput={(e) => onWidthChange((e.target as HTMLInputElement).value)}
                />
                <span class="unit-suffix" aria-hidden="true">
                  px
                </span>
              </div>
            </label>

            <label class="field-block">
              <span class="field-caption">Height</span>
              <div class="unit-input">
                <span class="unit-prefix" aria-hidden="true">
                  H
                </span>
                <input
                  type="number"
                  id="h"
                  min={1}
                  max={8000}
                  placeholder="auto"
                  inputMode="numeric"
                  value={heightStr}
                  onInput={(e) => onHeightChange((e.target as HTMLInputElement).value)}
                />
                <span class="unit-suffix" aria-hidden="true">
                  px
                </span>
              </div>
            </label>
          </div>

          <div class="field-block">
            <span class="field-caption" id="fit-group-label">
              How it fits
            </span>
            <div
              class="seg-group seg-4"
              id="fit"
              role="radiogroup"
              aria-labelledby="fit-group-label"
            >
              {FIT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={fit === opt.id}
                  data-fit={opt.id}
                  title={opt.title}
                  class={fit === opt.id ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => onFitChange(opt.id)}
                >
                  {renderFitIcon(opt.id)}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {fit === 'pad' && (
            <div class="field-block">
              <span class="field-caption" id="backdrop-group-label">
                Backdrop style
              </span>
              <div
                class="seg-group seg-4"
                id="backdrop"
                role="radiogroup"
                aria-labelledby="backdrop-group-label"
              >
                {BACKDROP_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={backdrop === opt.id}
                    data-backdrop={opt.id}
                    class={
                      backdrop === opt.id ? 'seg-btn seg-row-btn active' : 'seg-btn seg-row-btn'
                    }
                    onClick={() => onBackdropChange(opt.id)}
                  >
                    <span class={opt.swatchClass} aria-hidden="true" />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <label class="switch-row">
            <span class="switch-label">Don’t enlarge small images</span>
            <input
              type="checkbox"
              id="noup"
              class="switch-input"
              checked={dontEnlarge}
              onChange={(e) => onDontEnlargeChange((e.target as HTMLInputElement).checked)}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </fieldset>

        <fieldset class="inspector-section">
          <legend class="section-heading">Compression &amp; Format</legend>

          <div class="field-block">
            <span class="field-caption" id="fmt-group-label">
              Format
            </span>
            <div
              class="seg-group seg-3"
              id="fmt"
              role="radiogroup"
              aria-labelledby="fmt-group-label"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={format === opt.id}
                  data-format={opt.id}
                  class={format === opt.id ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => onFormatChange(opt.id)}
                >
                  <span class="seg-main-txt">{opt.label}</span>
                  {opt.tag && <small class="seg-sub-txt">{opt.tag}</small>}
                </button>
              ))}
            </div>
          </div>

          <div class="field-block">
            <label class="field-caption" for="target">
              Max file size
            </label>
            <div class="unit-input">
              <input
                type="number"
                id="target"
                min={5}
                placeholder="no limit"
                inputMode="numeric"
                value={maxKbStr}
                onInput={(e) => onMaxKbChange((e.target as HTMLInputElement).value)}
              />
              <span class="unit-suffix" aria-hidden="true">
                KB
              </span>
            </div>
            <div class="kb-chips">
              {QUICK_KB_TARGETS.map((kb) => (
                <button
                  key={kb}
                  type="button"
                  class={Number(maxKbStr) === kb ? 'kb-chip active' : 'kb-chip'}
                  onClick={() => onMaxKbChange(String(kb))}
                >
                  ≤{kb} KB
                </button>
              ))}
              <button
                type="button"
                class={maxKbStr.trim() === '' ? 'kb-chip active' : 'kb-chip'}
                onClick={() => onMaxKbChange('')}
              >
                No limit
              </button>
            </div>
          </div>

          <label class="slider-block" id="qWrap">
            <div class="slider-header">
              <span class="field-caption">Quality</span>
              <span class="value-pill">
                <strong id="qv">{quality}</strong>%
              </span>
            </div>
            <input
              type="range"
              id="q"
              class="studio-range"
              min={40}
              max={100}
              value={quality}
              disabled={qualityDisabled}
              onInput={(e) => onQualityChange(Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <p class="hint" id="qHint">
            {qualityHint}
          </p>
        </fieldset>

        <fieldset class="inspector-section">
          <legend class="section-heading">Enhancement</legend>

          <label class="switch-row">
            <span class="switch-label">Fix dull contrast</span>
            <input
              type="checkbox"
              id="auto"
              class="switch-input"
              checked={autoContrast}
              onChange={(e) => onAutoContrastChange((e.target as HTMLInputElement).checked)}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>

          <label class="slider-block">
            <div class="slider-header">
              <span class="field-caption">Sharpen after shrink</span>
              <span class="value-pill">
                <strong id="sv">{sharpenPct}</strong>%
              </span>
            </div>
            <input
              type="range"
              id="sharp"
              class="studio-range"
              min={0}
              max={100}
              value={sharpenPct}
              onInput={(e) => onSharpenChange(Number((e.target as HTMLInputElement).value))}
            />
          </label>
        </fieldset>
      </div>

      <div class="inspector-actions">
        <button
          type="button"
          class="primary-cta"
          id="dl"
          disabled={!canDownload}
          onClick={onDownload}
        >
          <DownloadIcon />
          <span>{dlLabel}</span>
        </button>

        <div class="action-pair">
          <button
            type="button"
            class="sec-btn"
            id="copyBtn"
            disabled={!canDownload || !clipboardSupported}
            onClick={onCopyImage}
            title={
              clipboardSupported
                ? 'Copy result image to clipboard'
                : 'Image clipboard copy unavailable in this browser'
            }
          >
            {copiedImageFeedback ? <CheckIcon /> : <CopyIcon />}
            <span>{copiedImageFeedback ? 'Copied!' : 'Copy image'}</span>
          </button>

          <button
            type="button"
            class="sec-btn"
            id="cmp"
            aria-label="Hold to see the original"
            disabled={!canCompare}
            onPointerDown={() => onCompareHold(true)}
            onPointerUp={() => onCompareHold(false)}
            onPointerLeave={() => onCompareHold(false)}
            onPointerCancel={() => onCompareHold(false)}
            onBlur={() => onCompareHold(false)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                onCompareHold(true);
              }
            }}
            onKeyUp={() => onCompareHold(false)}
          >
            <EyeIcon />
            <span>Compare</span>
          </button>
        </div>

        {hasFile && (
          <button type="button" class="ghost-btn" id="again" onClick={onChooseAnother}>
            <RefreshIcon />
            <span>Choose another image</span>
          </button>
        )}
      </div>
    </aside>
  );
}
