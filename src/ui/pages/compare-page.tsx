import { useEffect, useRef, useState } from 'preact/hooks';

import { formatExtension, formatFileSize, formatOutputFilename } from '../../engine/presets';
import type {
  InspectReport,
  OutputFormat,
  QualityBand,
  ResizeCompressOptions,
  ResizeCompressResult,
} from '../../engine/types';
import {
  DownloadIcon,
  PhotoIcon,
  ResizeIcon,
  ShieldIcon,
  SparklesIcon,
  SplitCompareIcon,
} from '../icons';

const COMPARE_FORMATS: readonly OutputFormat[] = ['jpeg', 'webp', 'png'];
const WIDTH_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Original', value: '' },
  { label: '1920 px', value: '1920' },
  { label: '1200 px', value: '1200' },
  { label: '800 px', value: '800' },
  { label: '600 px', value: '600' },
];

export interface CompareSourceState {
  key: string;
  file: File;
  report: InspectReport;
  origUrl: string;
  blockedReason: string | null;
}

export interface ComparePageProps {
  sourceState: CompareSourceState | null;
  isOver: boolean;
  onChooseFile: () => void;
  onLoadSample: () => void;
  onRunFormat: (
    options: ResizeCompressOptions,
    signal?: AbortSignal,
  ) => Promise<ResizeCompressResult>;
  onUseInResizer: (settings: {
    format: OutputFormat;
    quality: number;
    maxKbStr: string;
    autoContrast: boolean;
    sharpenPct: number;
    widthStr: string;
  }) => void;
}

interface CompareCardData {
  format: OutputFormat;
  result: ResizeCompressResult;
  url: string;
}

function qualityBandLabel(band: QualityBand): string {
  if (band === 'crisp') return 'Crisp';
  if (band === 'good') return 'Good';
  return 'Heavy';
}

function formatTitle(fmt: OutputFormat): string {
  if (fmt === 'webp') return 'WebP';
  if (fmt === 'png') return 'PNG';
  return 'JPEG';
}

function SyncedZoomLoupe(props: {
  srcUrl: string;
  nx: number;
  ny: number;
  zoom: 2 | 4;
  label: string;
}) {
  const { srcUrl, nx, ny, zoom, label } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImgRef = useRef<{ url: string; img: HTMLImageElement } | null>(null);

  useEffect(() => {
    let active = true;
    const draw = (img: HTMLImageElement) => {
      const canvas = canvasRef.current;
      if (!canvas || !active) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, cw, ch);

      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (nw <= 0 || nh <= 0) return;

      const sw = Math.max(8, Math.min(nw, cw / zoom));
      const sh = Math.max(8, Math.min(nh, ch / zoom));
      const sx = Math.max(0, Math.min(nw - sw, nx * nw - sw / 2));
      const sy = Math.max(0, Math.min(nh - sh, ny * nh - sh / 2));

      ctx.imageSmoothingEnabled = zoom < 4;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

      // Subtle Royal Blue inspection crosshair
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.78)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cw / 2, ch / 2 - 10);
      ctx.lineTo(cw / 2, ch / 2 + 10);
      ctx.moveTo(cw / 2 - 10, ch / 2);
      ctx.lineTo(cw / 2 + 10, ch / 2);
      ctx.stroke();
    };

    if (loadedImgRef.current?.url === srcUrl && loadedImgRef.current.img.complete) {
      draw(loadedImgRef.current.img);
      return;
    }

    const img = new Image();
    img.onload = () => {
      loadedImgRef.current = { url: srcUrl, img };
      draw(img);
    };
    img.src = srcUrl;

    return () => {
      active = false;
    };
  }, [srcUrl, nx, ny, zoom]);

  return (
    <div class="loupe-box">
      <div class="loupe-head">
        <span>{zoom}× Zoom Loupe</span>
        <span>
          {Math.round(nx * 100)}%, {Math.round(ny * 100)}%
        </span>
      </div>
      <canvas
        ref={canvasRef}
        class="loupe-canvas"
        width={280}
        height={160}
        aria-label={`${zoom}x detail loupe for ${label}`}
      />
    </div>
  );
}

export function ComparePage(props: ComparePageProps) {
  const { sourceState, isOver, onChooseFile, onLoadSample, onRunFormat, onUseInResizer } = props;

  const [widthStr, setWidthStr] = useState('1200');
  const [quality, setQuality] = useState(82);
  const [maxKbStr, setMaxKbStr] = useState('');
  const [autoContrast, setAutoContrast] = useState(true);
  const [sharpenEnabled, setSharpenEnabled] = useState(true);
  const [zoom, setZoom] = useState<2 | 4>(2);
  const [focus, setFocus] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [pinned, setPinned] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<Partial<Record<OutputFormat, CompareCardData>>>({});
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
      urlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!sourceState || sourceState.blockedReason) {
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
      urlsRef.current = [];
      setCards({});
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy(true);
        setError(null);
        const parsedWidth = Number(widthStr) > 0 ? Number(widthStr) : null;
        const parsedMaxKb = Number(maxKbStr) > 0 ? Math.round(Number(maxKbStr)) : null;
        const nextUrls: string[] = [];
        const nextCards: Partial<Record<OutputFormat, CompareCardData>> = {};

        try {
          for (const fmt of COMPARE_FORMATS) {
            if (controller.signal.aborted) return;
            const res = await onRunFormat(
              {
                targetWidth: parsedWidth,
                targetHeight: null,
                fit: 'inside',
                dontEnlarge: true,
                format: fmt,
                quality: quality / 100,
                minKb: null,
                maxKb: parsedMaxKb,
                dpi: null,
                autoContrast,
                sharpenPct: sharpenEnabled ? 35 : 0,
                allowShrinkToFitKb: true,
                assessQuality: true,
              },
              controller.signal,
            );
            if (controller.signal.aborted) return;
            const url = URL.createObjectURL(res.blob);
            nextUrls.push(url);
            nextCards[fmt] = { format: fmt, result: res, url };
          }

          if (controller.signal.aborted) {
            for (const u of nextUrls) URL.revokeObjectURL(u);
            return;
          }

          for (const u of urlsRef.current) URL.revokeObjectURL(u);
          urlsRef.current = nextUrls;
          setCards(nextCards);
        } catch (err) {
          for (const u of nextUrls) URL.revokeObjectURL(u);
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!controller.signal.aborted) setBusy(false);
        }
      })();
    }, 90);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sourceState, widthStr, quality, maxKbStr, autoContrast, sharpenEnabled, onRunFormat]);

  if (!sourceState || sourceState.blockedReason) {
    return (
      <section class="inspect-empty">
        <div
          class={isOver ? 'drop drop-hero over' : 'drop drop-hero'}
          tabIndex={0}
          role="button"
          aria-label="Choose an image to compare formats"
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
              <SplitCompareIcon class="icon-lg" />
            </div>
            <h2>Compare JPEG, WebP &amp; PNG side by side</h2>
            <p class="drop-sub">
              Inspect exact file sizes, PSNR quality, and a synchronized 2×/4× zoom loupe on any
              detail before you export.
            </p>
            <div class="hero-cta-row" onClick={(e) => e.stopPropagation()}>
              <button type="button" class="hero-btn-primary" onClick={onChooseFile}>
                <PhotoIcon />
                <span>Choose photo</span>
              </button>
              <button type="button" class="hero-btn-sec" onClick={onLoadSample}>
                <SparklesIcon />
                <span>Try sample photo</span>
              </button>
            </div>
            {sourceState?.blockedReason && (
              <p class="note note-err" role="alert">
                {sourceState.blockedReason}
              </p>
            )}
            <div class="hero-trust-strip">
              <span>
                <ShieldIcon /> Synced Pixel Loupe
              </span>
              <span>Honest Luma PSNR</span>
              <span>Zero Server Calls</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const readyCards = COMPARE_FORMATS.map((f) => cards[f]).filter((c): c is CompareCardData =>
    Boolean(c),
  );
  let smallestFormat: OutputFormat | null = null;
  let smallestBytes = Infinity;
  for (const c of readyCards) {
    if (c.result.bytes < smallestBytes) {
      smallestBytes = c.result.bytes;
      smallestFormat = c.format;
    }
  }

  function handlePointerUpdate(e: PointerEvent) {
    if (pinned) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocus({ x: nx, y: ny });
  }

  function handleDownloadCard(card: CompareCardData) {
    const filename = formatOutputFilename(
      sourceState!.file.name,
      card.result.width,
      card.result.height,
      card.result.actualFormat,
    );
    const a = document.createElement('a');
    a.href = card.url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const hasMaxKb = maxKbStr.trim() !== '' && Number(maxKbStr) > 0;

  return (
    <section class="stack">
      <div class="card compare-bar">
        <label class="compare-ctrl">
          <span class="field-caption">Max width</span>
          <select
            class="inspector-select"
            value={widthStr}
            onChange={(e) => setWidthStr((e.target as HTMLSelectElement).value)}
          >
            {WIDTH_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label class="compare-ctrl compare-ctrl-wide">
          <span class="field-caption">Quality ({quality}%)</span>
          <input
            type="range"
            class="studio-range"
            min={40}
            max={100}
            value={quality}
            disabled={hasMaxKb}
            onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))}
          />
        </label>

        <label class="compare-ctrl">
          <span class="field-caption">Max KB cap</span>
          <div class="unit-input">
            <input
              type="number"
              min={5}
              placeholder="none"
              value={maxKbStr}
              onInput={(e) => setMaxKbStr((e.target as HTMLInputElement).value)}
            />
            <span class="unit-suffix" aria-hidden="true">
              KB
            </span>
          </div>
        </label>

        <div class="compare-toggles">
          <label class="switch-row">
            <span class="switch-label">Auto-contrast</span>
            <input
              type="checkbox"
              class="switch-input"
              checked={autoContrast}
              onChange={(e) => setAutoContrast((e.target as HTMLInputElement).checked)}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
          <label class="switch-row">
            <span class="switch-label">Sharpen 35%</span>
            <input
              type="checkbox"
              class="switch-input"
              checked={sharpenEnabled}
              onChange={(e) => setSharpenEnabled((e.target as HTMLInputElement).checked)}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="compare-ctrl">
          <span class="field-caption">Loupe zoom</span>
          <div class="seg-group seg-2" role="group" aria-label="Zoom magnification">
            <button
              type="button"
              class={zoom === 2 ? 'seg-btn seg-row-btn active' : 'seg-btn seg-row-btn'}
              onClick={() => setZoom(2)}
            >
              2×
            </button>
            <button
              type="button"
              class={zoom === 4 ? 'seg-btn seg-row-btn active' : 'seg-btn seg-row-btn'}
              onClick={() => setZoom(4)}
            >
              4×
            </button>
          </div>
        </div>

        <div class="compare-bar-meta">
          <button type="button" class="btn btn-sec" onClick={onChooseFile}>
            <PhotoIcon />
            <span>Replace</span>
          </button>
          <span class="hint">
            {busy
              ? 'Rendering…'
              : pinned
                ? 'Loupe pinned · click any preview to unpin'
                : 'Hover any preview to inspect · click to pin'}
          </span>
        </div>
      </div>

      {error && (
        <div class="banner banner-err" role="alert">
          {error}
        </div>
      )}

      <div class="compare-grid">
        {COMPARE_FORMATS.map((fmt) => {
          const card = cards[fmt];
          const isWinner = smallestFormat === fmt && card !== undefined;
          const origBytes = sourceState.file.size;
          const savedPct =
            card && origBytes > 0 ? Math.round((1 - card.result.bytes / origBytes) * 100) : 0;
          const fmtSize = card ? formatFileSize(card.result.bytes) : null;

          return (
            <article class={isWinner ? 'card compare-card winner' : 'card compare-card'} key={fmt}>
              <header class="compare-card-head">
                <div>
                  <h3 class="compare-card-title">{formatTitle(fmt)}</h3>
                  <span class="muted">
                    {card
                      ? `${card.result.width}×${card.result.height} px · ${formatExtension(card.result.actualFormat)}`
                      : 'Encoding…'}
                  </span>
                </div>
                <div class="hud-badges">
                  {isWinner && <span class="xray-pill xray-pill-ok">Smallest</span>}
                  {card?.result.qualityAssessment && (
                    <span
                      class={`quality-badge quality-${card.result.qualityAssessment.band}`}
                      title={`Estimated luma PSNR: ${card.result.qualityAssessment.psnr} dB`}
                    >
                      {qualityBandLabel(card.result.qualityAssessment.band)}
                    </span>
                  )}
                </div>
              </header>

              <div class="compare-stat-row">
                <strong class="compare-size">
                  {fmtSize ? `${fmtSize.value} ${fmtSize.unit}` : '—'}
                </strong>
                {card && (
                  <span class={savedPct < 0 ? 'delta-pill up' : 'delta-pill'}>
                    {savedPct >= 0 ? `−${savedPct}` : `+${-savedPct}`}%
                  </span>
                )}
              </div>

              {card && card.result.actualFormat !== card.result.requestedFormat && (
                <p class="hint">
                  Browser lacked native {formatTitle(fmt)} encoder; emitted{' '}
                  {formatExtension(card.result.actualFormat).toUpperCase()}.
                </p>
              )}

              {card ? (
                <>
                  <div
                    class={pinned ? 'compare-preview-wrap pinned' : 'compare-preview-wrap'}
                    onPointerMove={handlePointerUpdate}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (rect.width > 0 && rect.height > 0) {
                        setFocus({
                          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
                          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
                        });
                      }
                      setPinned((p) => !p);
                    }}
                  >
                    <img src={card.url} alt={`${formatTitle(fmt)} comparison preview`} />
                  </div>

                  <SyncedZoomLoupe
                    srcUrl={card.url}
                    nx={focus.x}
                    ny={focus.y}
                    zoom={zoom}
                    label={formatTitle(fmt)}
                  />

                  <div class="compare-card-actions">
                    <button
                      type="button"
                      class="btn btn-sec"
                      onClick={() => handleDownloadCard(card)}
                    >
                      <DownloadIcon />
                      <span>Download</span>
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary"
                      onClick={() =>
                        onUseInResizer({
                          format: fmt,
                          quality,
                          maxKbStr,
                          autoContrast,
                          sharpenPct: sharpenEnabled ? 35 : 0,
                          widthStr,
                        })
                      }
                    >
                      <ResizeIcon />
                      <span>Use on Resize →</span>
                    </button>
                  </div>
                </>
              ) : (
                <div class="inspect-thumb-placeholder">Encoding {formatTitle(fmt)}…</div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
