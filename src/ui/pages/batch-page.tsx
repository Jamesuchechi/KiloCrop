import { useEffect, useRef, useState } from 'preact/hooks';

import {
  formatExtension,
  formatFileSize,
  formatOutputFilename,
  formatPresetOptionLabel,
} from '../../engine/presets';
import type {
  FitMode,
  OutputFormat,
  PadBackdropStyle,
  ResizeCompressOptions,
  ResizeCompressResult,
  SizePreset,
} from '../../engine/types';
import { createZipBlob } from '../../engine/zip';
import {
  ArchiveIcon,
  DownloadIcon,
  LayersIcon,
  PhotoIcon,
  ShieldIcon,
  SparklesIcon,
  StopIcon,
  TrashIcon,
} from '../icons';

const MAX_BATCH_FILES = 50;
const QUICK_KB_TARGETS = [25, 50, 100, 200] as const;

const FIT_OPTIONS: ReadonlyArray<{ id: FitMode; label: string }> = [
  { id: 'inside', label: 'Inside' },
  { id: 'fill', label: 'Crop' },
  { id: 'pad', label: 'Pad' },
  { id: 'stretch', label: 'Stretch' },
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

const FORMAT_OPTIONS: ReadonlyArray<{ id: OutputFormat; label: string }> = [
  { id: 'jpeg', label: 'JPEG' },
  { id: 'webp', label: 'WebP' },
  { id: 'png', label: 'PNG' },
];

type BatchItemStatus = 'queued' | 'working' | 'done' | 'error' | 'cancelled';

interface BatchQueueItem {
  id: number;
  file: File;
  status: BatchItemStatus;
  outputBlob?: Blob;
  outputName?: string;
  outBytes?: number;
  width?: number;
  height?: number;
  actualFormat?: OutputFormat;
  errorMsg?: string;
}

export interface BatchPageProps {
  presets: readonly SizePreset[];
  initialFiles?: File[];
  onConsumedInitialFiles?: () => void;
  onProcessFile: (
    file: File,
    options: ResizeCompressOptions,
    signal?: AbortSignal,
  ) => Promise<ResizeCompressResult>;
  onError?: (msg: string) => void;
}

function parseOptionalInt(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createBatchSampleFiles(): Promise<File[]> {
  const specs = [
    { name: 'batch-product-blue.jpg', bg1: '#1e3a8a', bg2: '#3b82f6', w: 1200, h: 900 },
    { name: 'batch-portrait-slate.jpg', bg1: '#0f172a', bg2: '#475569', w: 900, h: 1200 },
    { name: 'batch-card-indigo.jpg', bg1: '#1d4ed8', bg2: '#60a5fa', w: 1400, h: 900 },
    { name: 'batch-banner-dark.jpg', bg1: '#111827', bg2: '#2563eb', w: 1600, h: 800 },
  ];

  const out: File[] = [];
  for (let idx = 0; idx < specs.length; idx++) {
    const s = specs[idx]!;
    const canvas = document.createElement('canvas');
    canvas.width = s.w;
    canvas.height = s.h;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      const grad = ctx.createLinearGradient(0, 0, s.w, s.h);
      grad.addColorStop(0, s.bg1);
      grad.addColorStop(1, s.bg2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s.w, s.h);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.w / 2, s.h / 2 - 20, Math.min(s.w, s.h) * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
      ctx.fillRect(s.w * 0.15, s.h * 0.76, s.w * 0.7, 80);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`KiloCrop Sample #${idx + 1}`, s.w / 2, s.h * 0.76 + 52);

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Sample encode failed'))),
          'image/jpeg',
          0.9,
        ),
      );
      out.push(new File([blob], s.name, { type: 'image/jpeg' }));
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
  return out;
}

export function BatchPage(props: BatchPageProps) {
  const { presets, initialFiles, onConsumedInitialFiles, onProcessFile, onError } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const [items, setItems] = useState<BatchQueueItem[]>([]);
  const [isOver, setIsOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Shared batch settings
  const [presetId, setPresetId] = useState('custom');
  const [widthStr, setWidthStr] = useState('1200');
  const [heightStr, setHeightStr] = useState('');
  const [fit, setFit] = useState<FitMode>('inside');
  const [backdrop, setBackdrop] = useState<PadBackdropStyle>('blur');
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [maxKbStr, setMaxKbStr] = useState('');
  const [quality, setQuality] = useState(82);
  const [autoContrast, setAutoContrast] = useState(true);
  const [sharpenPct, setSharpenPct] = useState(35);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      appendFiles(initialFiles);
      onConsumedInitialFiles?.();
    }
  }, [initialFiles, onConsumedInitialFiles]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function appendFiles(fileList: FileList | File[]) {
    const picked = Array.from(fileList).filter(
      (f) => !f.type || f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp)$/i.test(f.name),
    );
    if (picked.length === 0) return;

    setItems((prev) => {
      const remaining = Math.max(0, MAX_BATCH_FILES - prev.length);
      if (remaining === 0) {
        setNotice(`Batch queue is full (max ${MAX_BATCH_FILES} images).`);
        return prev;
      }
      const accepted = picked.slice(0, remaining);
      if (picked.length > remaining) {
        setNotice(
          `Added ${accepted.length} images; capped at ${MAX_BATCH_FILES} per batch for mobile RAM safety.`,
        );
      } else {
        setNotice(null);
      }
      const added: BatchQueueItem[] = accepted.map((file) => ({
        id: seqRef.current++,
        file,
        status: 'queued',
      }));
      return [...prev, ...added];
    });
  }

  async function handleLoadSamples() {
    try {
      const samples = await createBatchSampleFiles();
      appendFiles(samples);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotice(msg);
      onError?.(msg);
    }
  }

  function applyPreset(nextId: string) {
    setPresetId(nextId);
    const p = presets.find((x) => x.id === nextId);
    if (!p) return;
    setWidthStr(p.width ? String(p.width) : '');
    setHeightStr(p.height ? String(p.height) : '');
    setFit(p.fit);
    if (p.backdrop) setBackdrop(p.backdrop);
    if (p.format) setFormat(p.format);
    setMaxKbStr(p.maxKb ? String(p.maxKb) : '');
    if (typeof p.autoContrast === 'boolean') setAutoContrast(p.autoContrast);
    if (typeof p.sharpenPct === 'number') setSharpenPct(p.sharpenPct);
  }

  async function startBatch() {
    if (running || items.length === 0) return;

    const snapshot = items.map((item) => ({
      ...item,
      status: 'queued' as BatchItemStatus,
      outputBlob: undefined,
      outputName: undefined,
      outBytes: undefined,
      errorMsg: undefined,
    }));
    setItems(snapshot);
    setNotice(null);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const options: ResizeCompressOptions = {
      targetWidth: parseOptionalInt(widthStr),
      targetHeight: parseOptionalInt(heightStr),
      fit,
      backdrop,
      dontEnlarge,
      autoFocus: true,
      format,
      quality: quality / 100,
      minKb: null,
      maxKb: parseOptionalInt(maxKbStr),
      dpi: null,
      autoContrast,
      sharpenPct,
      allowShrinkToFitKb: true,
      assessQuality: false,
    };

    try {
      for (const item of snapshot) {
        if (controller.signal.aborted) break;
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, status: 'working' } : row)),
        );

        try {
          const res = await onProcessFile(item.file, options, controller.signal);
          const outName = formatOutputFilename(
            item.file.name,
            res.width,
            res.height,
            res.actualFormat,
          );
          setItems((prev) =>
            prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    status: 'done',
                    outputBlob: res.blob,
                    outputName: outName,
                    outBytes: res.bytes,
                    width: res.width,
                    height: res.height,
                    actualFormat: res.actualFormat,
                  }
                : row,
            ),
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            setItems((prev) =>
              prev.map((row) =>
                row.status === 'queued' || row.status === 'working'
                  ? { ...row, status: 'cancelled' }
                  : row,
              ),
            );
            break;
          }
          const msg = err instanceof Error ? err.message : String(err);
          setItems((prev) =>
            prev.map((row) =>
              row.id === item.id ? { ...row, status: 'error', errorMsg: msg } : row,
            ),
          );
        }
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleDownloadZip() {
    const finished = items.filter((i) => i.status === 'done' && i.outputBlob && i.outputName);
    if (finished.length === 0) return;
    const entries = await Promise.all(
      finished.map(async (item) => ({
        name: item.outputName!,
        data: new Uint8Array(await item.outputBlob!.arrayBuffer()),
      })),
    );
    const zipBlob = createZipBlob(entries);
    triggerDownload(zipBlob, `kilocrop-batch-${finished.length}.zip`);
  }

  const doneItems = items.filter((i) => i.status === 'done');
  const totalInBytes = items.reduce((sum, i) => sum + i.file.size, 0);
  const totalOutBytes = doneItems.reduce((sum, i) => sum + (i.outBytes ?? 0), 0);
  const totalDoneOrigBytes = doneItems.reduce((sum, i) => sum + i.file.size, 0);
  const savedPct =
    totalDoneOrigBytes > 0 ? Math.round((1 - totalOutBytes / totalDoneOrigBytes) * 100) : 0;

  const isPng = format === 'png';
  const maxKbNum = Number(maxKbStr);
  const hasMaxKb = maxKbStr.trim() !== '' && Number.isFinite(maxKbNum) && maxKbNum > 0;

  return (
    <main class="studio-main">
      <section class="stage-canvas">
        {items.length === 0 ? (
          <div
            class={isOver ? 'drop drop-hero over' : 'drop drop-hero'}
            tabIndex={0}
            role="button"
            aria-label="Choose images for batch resize"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => {
              e.preventDefault();
              setIsOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsOver(false);
              if (e.dataTransfer?.files) appendFiles(e.dataTransfer.files);
            }}
          >
            <div class="drop-hero-inner">
              <div class="drop-medallion" aria-hidden="true">
                <LayersIcon class="icon-lg" />
              </div>
              <h2>Drop 2–50 images here</h2>
              <p class="drop-sub">
                Resize and compress an entire folder strictly 1-at-a-time in memory, then download a
                single ZIP archive.
              </p>
              <div class="hero-cta-row" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  class="hero-btn-primary"
                  onClick={() => inputRef.current?.click()}
                >
                  <PhotoIcon />
                  <span>Choose photos</span>
                </button>
                <button type="button" class="hero-btn-sec" onClick={() => void handleLoadSamples()}>
                  <SparklesIcon />
                  <span>Try 4 sample photos</span>
                </button>
              </div>
              <div class="hero-trust-strip">
                <span>
                  <ShieldIcon /> Sequential 1-at-a-Time RAM Cap
                </span>
                <span>STORE ZIP (0 Re-compression)</span>
                <span>Nothing Uploaded</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            class="stage-work"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!running && e.dataTransfer?.files) appendFiles(e.dataTransfer.files);
            }}
          >
            <div class="stage-hud">
              <div class="hud-left">
                <div class="big">
                  {doneItems.length}
                  <small>/ {items.length}</small>
                </div>
                <div class="hud-badges">
                  <span class="quality-badge quality-good">
                    {formatFileSize(totalInBytes).value} {formatFileSize(totalInBytes).unit} total
                    input
                  </span>
                  {doneItems.length > 0 && (
                    <strong class={savedPct < 0 ? 'delta-pill up' : 'delta-pill'}>
                      {savedPct >= 0 ? `−${savedPct}` : `+${-savedPct}`}% (
                      {formatFileSize(totalOutBytes).value} {formatFileSize(totalOutBytes).unit})
                    </strong>
                  )}
                </div>
              </div>

              <div class="batch-actions">
                {running ? (
                  <button type="button" class="sec-btn" onClick={handleCancel}>
                    <StopIcon />
                    <span>Cancel</span>
                  </button>
                ) : (
                  <button type="button" class="btn btn-primary" onClick={() => void startBatch()}>
                    <SparklesIcon />
                    <span>Process {items.length} photos</span>
                  </button>
                )}
                <button
                  type="button"
                  class="btn btn-sec"
                  disabled={running || doneItems.length === 0}
                  onClick={() => void handleDownloadZip()}
                >
                  <ArchiveIcon />
                  <span>Download all (.zip)</span>
                </button>
                <button
                  type="button"
                  class="btn btn-sec"
                  disabled={running || items.length >= MAX_BATCH_FILES}
                  onClick={() => inputRef.current?.click()}
                >
                  <PhotoIcon />
                  <span>Add more</span>
                </button>
                <button
                  type="button"
                  class="ghost-btn"
                  disabled={running}
                  onClick={() => {
                    setItems([]);
                    setNotice(null);
                  }}
                >
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <progress class="batch-progress" value={doneItems.length} max={items.length} />

            {notice && <div class="note-bar note-info">{notice}</div>}

            <div class="card batch-table-card">
              <div class="batch-table" role="table" aria-label="Batch image queue">
                <div class="batch-row batch-head" role="row">
                  <span role="columnheader">File</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Size change</span>
                  <span role="columnheader">Action</span>
                </div>
                {items.map((item) => {
                  const inFmt = formatFileSize(item.file.size);
                  const outFmt = item.outBytes ? formatFileSize(item.outBytes) : null;
                  const pct =
                    item.outBytes && item.file.size > 0
                      ? Math.round((1 - item.outBytes / item.file.size) * 100)
                      : 0;
                  return (
                    <div class="batch-row" role="row" key={item.id}>
                      <div class="batch-file-cell" role="cell">
                        <strong class="batch-filename">{item.file.name}</strong>
                        <span class="muted">
                          {item.width && item.height && item.actualFormat
                            ? `${item.width}×${item.height} px · ${formatExtension(item.actualFormat)}`
                            : `${inFmt.value} ${inFmt.unit}`}
                        </span>
                      </div>
                      <div role="cell">
                        <span class={`xray-pill batch-pill-${item.status}`}>
                          {item.status === 'queued' && 'Queued'}
                          {item.status === 'working' && 'Working…'}
                          {item.status === 'done' && 'Done'}
                          {item.status === 'error' && 'Error'}
                          {item.status === 'cancelled' && 'Cancelled'}
                        </span>
                        {item.errorMsg && <div class="hint">{item.errorMsg}</div>}
                      </div>
                      <div class="batch-size-cell" role="cell">
                        {outFmt ? (
                          <span>
                            {inFmt.value} {inFmt.unit} →{' '}
                            <strong>
                              {outFmt.value} {outFmt.unit}
                            </strong>{' '}
                            <span class={pct < 0 ? 'delta-pill up' : 'delta-pill'}>
                              {pct >= 0 ? `−${pct}` : `+${-pct}`}%
                            </span>
                          </span>
                        ) : (
                          <span class="muted">
                            {inFmt.value} {inFmt.unit}
                          </span>
                        )}
                      </div>
                      <div class="batch-row-actions" role="cell">
                        {item.status === 'done' && item.outputBlob && item.outputName && (
                          <button
                            type="button"
                            class="tool-chip"
                            onClick={() => triggerDownload(item.outputBlob!, item.outputName!)}
                            aria-label={`Download ${item.file.name}`}
                          >
                            <DownloadIcon />
                            <span>Save</span>
                          </button>
                        )}
                        <button
                          type="button"
                          class="tool-chip tool-chip-danger"
                          disabled={running}
                          aria-label={`Remove ${item.file.name}`}
                          onClick={() =>
                            setItems((prev) => prev.filter((row) => row.id !== item.id))
                          }
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      <aside class="controls-panel" aria-label="Shared batch settings">
        <div class="inspector-scroll">
          <fieldset class="inspector-section">
            <legend class="section-heading">Shared Batch Target</legend>

            <label class="field-block">
              <span class="field-caption">Preset</span>
              <select
                id="batch-preset"
                class="inspector-select"
                value={presetId}
                disabled={running}
                onChange={(e) => applyPreset((e.target as HTMLSelectElement).value)}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPresetOptionLabel(p)}
                  </option>
                ))}
              </select>
            </label>

            <div class="row">
              <label class="field-block">
                <span class="field-caption">Width</span>
                <div class="unit-input">
                  <span class="unit-prefix" aria-hidden="true">
                    W
                  </span>
                  <input
                    type="number"
                    id="batch-w"
                    min={1}
                    max={8000}
                    placeholder="auto"
                    value={widthStr}
                    disabled={running}
                    onInput={(e) => {
                      setPresetId('custom');
                      setWidthStr((e.target as HTMLInputElement).value);
                    }}
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
                    id="batch-h"
                    min={1}
                    max={8000}
                    placeholder="auto"
                    value={heightStr}
                    disabled={running}
                    onInput={(e) => {
                      setPresetId('custom');
                      setHeightStr((e.target as HTMLInputElement).value);
                    }}
                  />
                  <span class="unit-suffix" aria-hidden="true">
                    px
                  </span>
                </div>
              </label>
            </div>

            <div class="field-block">
              <span class="field-caption">How it fits</span>
              <div class="seg-group seg-4" role="radiogroup" aria-label="Batch fit mode">
                {FIT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={fit === opt.id}
                    disabled={running}
                    class={fit === opt.id ? 'seg-btn active' : 'seg-btn'}
                    onClick={() => setFit(opt.id)}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {fit === 'pad' && (
              <div class="field-block">
                <span class="field-caption">Backdrop</span>
                <div class="seg-group seg-4" role="radiogroup" aria-label="Batch backdrop style">
                  {BACKDROP_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={backdrop === opt.id}
                      disabled={running}
                      class={
                        backdrop === opt.id ? 'seg-btn seg-row-btn active' : 'seg-btn seg-row-btn'
                      }
                      onClick={() => setBackdrop(opt.id)}
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
                class="switch-input"
                checked={dontEnlarge}
                disabled={running}
                onChange={(e) => setDontEnlarge((e.target as HTMLInputElement).checked)}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>
          </fieldset>

          <fieldset class="inspector-section">
            <legend class="section-heading">Output &amp; KB Cap</legend>

            <div class="seg-group seg-3" role="radiogroup" aria-label="Batch output format">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={format === opt.id}
                  disabled={running}
                  class={format === opt.id ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setFormat(opt.id)}
                >
                  <span class="seg-main-txt">{opt.label}</span>
                </button>
              ))}
            </div>

            <div class="field-block">
              <label class="field-caption" for="batch-maxkb">
                Max file size
              </label>
              <div class="unit-input">
                <input
                  type="number"
                  id="batch-maxkb"
                  min={5}
                  placeholder="no limit"
                  value={maxKbStr}
                  disabled={running}
                  onInput={(e) => setMaxKbStr((e.target as HTMLInputElement).value)}
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
                    disabled={running}
                    class={Number(maxKbStr) === kb ? 'kb-chip active' : 'kb-chip'}
                    onClick={() => setMaxKbStr(String(kb))}
                  >
                    ≤{kb} KB
                  </button>
                ))}
                <button
                  type="button"
                  disabled={running}
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
                disabled={running || isPng || hasMaxKb}
                onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </fieldset>

          <fieldset class="inspector-section">
            <legend class="section-heading">Enhancement</legend>
            <label class="switch-row">
              <span class="switch-label">Fix dull contrast</span>
              <input
                type="checkbox"
                class="switch-input"
                checked={autoContrast}
                disabled={running}
                onChange={(e) => setAutoContrast((e.target as HTMLInputElement).checked)}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>

            <label class="slider-block">
              <div class="slider-header">
                <span class="field-caption">Sharpen</span>
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
                disabled={running}
                onInput={(e) => setSharpenPct(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </fieldset>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          class="sr-only"
          onChange={(e) => {
            const inp = e.target as HTMLInputElement;
            if (inp.files) appendFiles(inp.files);
            inp.value = '';
          }}
        />
      </aside>
    </main>
  );
}
