import { useEffect, useRef, useState } from 'preact/hooks';

import { formatExtension, formatFileSize } from '../../engine/presets';
import type {
  DocumentCleanOptions,
  DocumentCleanResult,
  DocumentColorMode,
  OutputFormat,
} from '../../engine/types';
import {
  DocumentIcon,
  DownloadIcon,
  EyeIcon,
  PhotoIcon,
  RefreshIcon,
  ShieldIcon,
  SparklesIcon,
} from '../icons';
import type { CompareSourceState } from './compare-page';

const DOC_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  width: number;
  maxKb: number;
  mode: DocumentColorMode;
  level: number;
  whiten: number;
  sharpen: number;
}> = [
  {
    id: 'cert',
    label: 'Certificate ≤ 150 KB',
    width: 1600,
    maxKb: 150,
    mode: 'color-clean',
    level: 75,
    whiten: 55,
    sharpen: 45,
  },
  {
    id: 'slip',
    label: 'Exam Slip ≤ 100 KB',
    width: 1400,
    maxKb: 100,
    mode: 'grayscale',
    level: 80,
    whiten: 60,
    sharpen: 50,
  },
  {
    id: 'portal',
    label: 'Portal Scan ≤ 200 KB',
    width: 1600,
    maxKb: 200,
    mode: 'color-clean',
    level: 70,
    whiten: 50,
    sharpen: 40,
  },
  {
    id: 'sig',
    label: 'Signature ≤ 50 KB',
    width: 800,
    maxKb: 50,
    mode: 'bw',
    level: 85,
    whiten: 65,
    sharpen: 50,
  },
];

const DOC_MODES: ReadonlyArray<{ id: DocumentColorMode; label: string }> = [
  { id: 'color-clean', label: 'Color Clean' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'bw', label: 'Clean B&W' },
];

const QUICK_KB = [50, 100, 150, 200] as const;

export interface DocumentsPageProps {
  sourceState: CompareSourceState | null;
  isOver: boolean;
  onChooseFile: () => void;
  onLoadSampleDocument: () => void;
  onRunDocumentClean: (
    options: DocumentCleanOptions,
    signal?: AbortSignal,
  ) => Promise<DocumentCleanResult>;
}

function docModeLabel(mode: DocumentColorMode): string {
  if (mode === 'grayscale') return 'Grayscale';
  if (mode === 'bw') return 'Clean B&W';
  return 'Color Clean';
}

export function DocumentsPage(props: DocumentsPageProps) {
  const { sourceState, isOver, onChooseFile, onLoadSampleDocument, onRunDocumentClean } = props;

  const [mode, setMode] = useState<DocumentColorMode>('color-clean');
  const [levelStrength, setLevelStrength] = useState(75);
  const [whitenPaper, setWhitenPaper] = useState(55);
  const [sharpenPct, setSharpenPct] = useState(45);
  const [bwBias, setBwBias] = useState(0);
  const [widthStr, setWidthStr] = useState('1600');
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [maxKbStr, setMaxKbStr] = useState('150');
  const [quality, setQuality] = useState(84);

  const [comparingOriginal, setComparingOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{ result: DocumentCleanResult; url: string } | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const lastImmediateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sourceState || sourceState.blockedReason) {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
      lastImmediateKeyRef.current = null;
      setOutput(null);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    const isInitial = lastImmediateKeyRef.current !== sourceState.key;
    lastImmediateKeyRef.current = sourceState.key;
    if (isInitial) setBusy(true);

    const runClean = async () => {
      setBusy(true);
      setError(null);
      const w = Number(widthStr) > 0 ? Math.min(3600, Math.round(Number(widthStr))) : null;
      const maxKb = Number(maxKbStr) > 0 ? Math.round(Number(maxKbStr)) : null;

      try {
        const result = await onRunDocumentClean(
          {
            targetWidth: w,
            targetHeight: null,
            mode,
            levelStrength,
            whitenPaper,
            sharpenPct,
            bwBias,
            format,
            quality: quality / 100,
            maxKb,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(result.blob);
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setOutput({ result, url });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };

    if (isInitial) {
      void runClean();
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => {
      void runClean();
    }, 90);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    sourceState,
    mode,
    levelStrength,
    whitenPaper,
    sharpenPct,
    bwBias,
    widthStr,
    format,
    maxKbStr,
    quality,
    onRunDocumentClean,
  ]);

  function applyQuickPreset(p: (typeof DOC_PRESETS)[number]) {
    setMode(p.mode);
    setLevelStrength(p.level);
    setWhitenPaper(p.whiten);
    setSharpenPct(p.sharpen);
    setWidthStr(String(p.width));
    setMaxKbStr(String(p.maxKb));
  }

  function handleDownload() {
    if (!output || !sourceState) return;
    const base = sourceState.file.name.replace(/\.[^.]+$/, '') || 'document';
    const ext = formatExtension(output.result.actualFormat);
    const a = document.createElement('a');
    a.href = output.url;
    a.download = `${base}-cleaned.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const hasFile = Boolean(sourceState && !sourceState.blockedReason);
  const hasMaxKb = maxKbStr.trim() !== '' && Number(maxKbStr) > 0;
  const origBytes = sourceState?.file.size ?? 0;
  const savedPct =
    output && origBytes > 0 ? Math.round((1 - output.result.bytes / origBytes) * 100) : 0;
  const newFmt = output ? formatFileSize(output.result.bytes) : null;
  const displayUrl = comparingOriginal
    ? (sourceState?.origUrl ?? output?.url ?? '')
    : (output?.url ?? '');
  const tagLabel = !output || busy ? 'Cleaning…' : comparingOriginal ? 'Original' : 'Cleaned';

  return (
    <main class="studio-main">
      <section class="stage-canvas">
        {!hasFile ? (
          <div
            class={isOver ? 'drop drop-hero over' : 'drop drop-hero'}
            tabIndex={0}
            role="button"
            aria-label="Choose a scanned document or certificate"
            onClick={onChooseFile}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChooseFile();
              }
            }}
          >
            <div class="drop-hero-inner">
              <div class="drop-medallion" aria-hidden="true">
                <DocumentIcon class="icon-lg" />
              </div>
              <h2>Clean shadowed scans &amp; certificates</h2>
              <p class="drop-sub">
                Level uneven phone shadows on white paper, sharpen text strokes, preserve stamps or
                convert to crisp B&amp;W, and hit tight KB upload caps.
              </p>
              <div class="hero-cta-row" onClick={(e) => e.stopPropagation()}>
                <button type="button" class="hero-btn-primary" onClick={onChooseFile}>
                  <PhotoIcon />
                  <span>Choose document</span>
                </button>
                <button type="button" class="hero-btn-sec" onClick={onLoadSampleDocument}>
                  <SparklesIcon />
                  <span>Try sample document</span>
                </button>
              </div>
              {sourceState?.blockedReason && (
                <p class="note note-err" role="alert">
                  {sourceState.blockedReason}
                </p>
              )}
              <div class="hero-trust-strip">
                <span>
                  <ShieldIcon /> Shadow Leveling
                </span>
                <span>Crisp Text Sharpen</span>
                <span>Strict 50–200 KB Caps</span>
              </div>
            </div>
          </div>
        ) : (
          <div class="stage-work">
            <div class="stage-hud">
              <div class="hud-left">
                <div class="big" id="docNewSize" aria-live="polite">
                  {newFmt ? newFmt.value : '–'}
                  {newFmt && <small>{newFmt.unit}</small>}
                </div>
                {output && (
                  <div class="hud-badges">
                    <strong class={savedPct < 0 ? 'delta-pill up' : 'delta-pill'}>
                      {savedPct >= 0 ? `−${savedPct}` : `+${-savedPct}`}%
                    </strong>
                    <span class="quality-badge quality-good">{docModeLabel(mode)}</span>
                  </div>
                )}
              </div>

              {output && (
                <div class="hud-right">
                  <div class="meta">
                    <span>
                      was {formatFileSize(origBytes).value} {formatFileSize(origBytes).unit} ·{' '}
                      {output.result.originalWidth}×{output.result.originalHeight}
                    </span>
                    <span class="meta-now">
                      now {output.result.width}×{output.result.height} px,{' '}
                      {formatExtension(output.result.actualFormat)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div class="view">
              {displayUrl && <img id="docImg" src={displayUrl} alt="Cleaned document preview" />}
              <span class="tag">{tagLabel}</span>
            </div>

            {error && (
              <div class="note-bar note-err" role="alert">
                <span>{error}</span>
              </div>
            )}
            {!error && output?.result.shrunkToFitKb && (
              <div class="note-bar" role="status">
                <span>
                  Scaled to {output.result.width}×{output.result.height} px to stay within the{' '}
                  {maxKbStr} KB cap.
                </span>
              </div>
            )}
            {!error && output?.result.status === 'infeasible-max' && (
              <div class="note-bar" role="status">
                <span>
                  Smallest legible output is {newFmt?.value} {newFmt?.unit}. Switch to Grayscale,
                  Clean B&amp;W, or WebP for a smaller file.
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <aside class="controls-panel" aria-label="Document cleanup settings">
        <div class="inspector-scroll">
          <fieldset class="inspector-section">
            <legend class="section-heading">Quick Document Target</legend>
            <div class="kb-chips">
              {DOC_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class="kb-chip"
                  onClick={() => applyQuickPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset class="inspector-section">
            <legend class="section-heading">Paper &amp; Ink</legend>

            <div class="field-block">
              <span class="field-caption">Mode</span>
              <div class="seg-group seg-3" role="radiogroup" aria-label="Document color mode">
                {DOC_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    data-doc-mode={m.id}
                    aria-checked={mode === m.id}
                    class={mode === m.id ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => setMode(m.id)}
                  >
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <label class="slider-block">
              <div class="slider-header">
                <span class="field-caption">Shadow removal</span>
                <span class="value-pill">
                  <strong>{levelStrength}</strong>%
                </span>
              </div>
              <input
                type="range"
                class="studio-range"
                min={0}
                max={100}
                value={levelStrength}
                onInput={(e) => setLevelStrength(Number((e.target as HTMLInputElement).value))}
              />
            </label>

            <label class="slider-block">
              <div class="slider-header">
                <span class="field-caption">Whiten paper</span>
                <span class="value-pill">
                  <strong>{whitenPaper}</strong>%
                </span>
              </div>
              <input
                type="range"
                class="studio-range"
                min={0}
                max={100}
                value={whitenPaper}
                onInput={(e) => setWhitenPaper(Number((e.target as HTMLInputElement).value))}
              />
            </label>

            <label class="slider-block">
              <div class="slider-header">
                <span class="field-caption">Text sharpen</span>
                <span class="value-pill">
                  <strong>{sharpenPct}</strong>%
                </span>
              </div>
              <input
                type="range"
                class="studio-range"
                min={0}
                max={100}
                value={sharpenPct}
                onInput={(e) => setSharpenPct(Number((e.target as HTMLInputElement).value))}
              />
            </label>

            {mode === 'bw' && (
              <label class="slider-block">
                <div class="slider-header">
                  <span class="field-caption">Ink darkness</span>
                  <span class="value-pill">
                    <strong>{bwBias > 0 ? `+${bwBias}` : bwBias}</strong>
                  </span>
                </div>
                <input
                  type="range"
                  class="studio-range"
                  min={-40}
                  max={40}
                  value={bwBias}
                  onInput={(e) => setBwBias(Number((e.target as HTMLInputElement).value))}
                />
              </label>
            )}
          </fieldset>

          <fieldset class="inspector-section">
            <legend class="section-heading">Output &amp; KB Limit</legend>

            <label class="field-block">
              <span class="field-caption">Max width</span>
              <div class="unit-input">
                <span class="unit-prefix" aria-hidden="true">
                  W
                </span>
                <input
                  type="number"
                  min={200}
                  max={3600}
                  placeholder="auto"
                  value={widthStr}
                  onInput={(e) => setWidthStr((e.target as HTMLInputElement).value)}
                />
                <span class="unit-suffix" aria-hidden="true">
                  px
                </span>
              </div>
            </label>

            <div class="seg-group seg-3" role="radiogroup" aria-label="Document format">
              {(['jpeg', 'webp', 'png'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  role="radio"
                  aria-checked={format === fmt}
                  class={format === fmt ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setFormat(fmt)}
                >
                  <span class="seg-main-txt">{fmt.toUpperCase()}</span>
                </button>
              ))}
            </div>

            <div class="field-block">
              <label class="field-caption" for="doc-maxkb">
                Max file size
              </label>
              <div class="unit-input">
                <input
                  type="number"
                  id="doc-maxkb"
                  min={5}
                  placeholder="no limit"
                  value={maxKbStr}
                  onInput={(e) => setMaxKbStr((e.target as HTMLInputElement).value)}
                />
                <span class="unit-suffix" aria-hidden="true">
                  KB
                </span>
              </div>
              <div class="kb-chips">
                {QUICK_KB.map((kb) => (
                  <button
                    key={kb}
                    type="button"
                    class={Number(maxKbStr) === kb ? 'kb-chip active' : 'kb-chip'}
                    onClick={() => setMaxKbStr(String(kb))}
                  >
                    ≤{kb} KB
                  </button>
                ))}
                <button
                  type="button"
                  class={maxKbStr.trim() === '' ? 'kb-chip active' : 'kb-chip'}
                  onClick={() => setMaxKbStr('')}
                >
                  No limit
                </button>
              </div>
            </div>

            <label class="slider-block">
              <div class="slider-header">
                <span class="field-caption">Quality</span>
                <span class="value-pill">
                  <strong>{quality}</strong>%
                </span>
              </div>
              <input
                type="range"
                class="studio-range"
                min={40}
                max={100}
                value={quality}
                disabled={format === 'png' || hasMaxKb}
                onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </fieldset>
        </div>

        <div class="inspector-actions">
          <button
            type="button"
            id="docDl"
            class="primary-cta"
            disabled={!output || busy}
            onClick={handleDownload}
          >
            <DownloadIcon />
            <span>
              {newFmt
                ? `Download ${formatExtension(output!.result.actualFormat).toUpperCase()} · ${newFmt.value} ${newFmt.unit}`
                : 'Download clean document'}
            </span>
          </button>

          <div class="action-pair">
            <button
              type="button"
              class="sec-btn"
              disabled={!hasFile || !output}
              onPointerDown={() => setComparingOriginal(true)}
              onPointerUp={() => setComparingOriginal(false)}
              onPointerLeave={() => setComparingOriginal(false)}
              onPointerCancel={() => setComparingOriginal(false)}
              onBlur={() => setComparingOriginal(false)}
            >
              <EyeIcon />
              <span>Hold to compare</span>
            </button>
            <button type="button" class="sec-btn" onClick={onChooseFile}>
              <RefreshIcon />
              <span>Replace file</span>
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
