import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { formatFileSize } from '../../engine/presets';
import type { WebKitAsset, WebKitOptions, WebKitResult } from '../../engine/types';
import { buildPictureMarkup } from '../../engine/web-kit';
import { createZipBlob } from '../../engine/zip';
import {
  ArchiveIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PhotoIcon,
  RefreshIcon,
  ShieldIcon,
  SparklesIcon,
} from '../icons';
import type { CompareSourceState } from './compare-page';

const BREAKPOINT_CHOICES = [320, 480, 960, 1200, 1600, 2000] as const;

export interface WebKitPageProps {
  sourceState: CompareSourceState | null;
  isOver: boolean;
  onChooseFile: () => void;
  onLoadSample: () => void;
  onRunWebKit: (options: WebKitOptions, signal?: AbortSignal) => Promise<WebKitResult>;
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

export function WebKitPage(props: WebKitPageProps) {
  const { sourceState, isOver, onChooseFile, onLoadSample, onRunWebKit } = props;

  const [selectedWidths, setSelectedWidths] = useState<number[]>([480, 960, 1600]);
  const [includeWebp, setIncludeWebp] = useState(true);
  const [includeJpeg, setIncludeJpeg] = useState(true);
  const [includeLqip, setIncludeLqip] = useState(true);
  const [quality, setQuality] = useState(82);
  const [autoContrast, setAutoContrast] = useState(true);
  const [sharpenPct, setSharpenPct] = useState(35);

  const [assetPrefix, setAssetPrefix] = useState('/images/');
  const [altText, setAltText] = useState('Responsive studio image');
  const [sizesAttr, setSizesAttr] = useState('(max-width: 768px) 100vw, 960px');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebKitResult | null>(null);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedLqip, setCopiedLqip] = useState(false);
  const lastImmediateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceState || sourceState.blockedReason) {
      lastImmediateKeyRef.current = null;
      setResult(null);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    const isInitial = lastImmediateKeyRef.current !== sourceState.key;
    lastImmediateKeyRef.current = sourceState.key;
    if (isInitial) setBusy(true);

    const runExportJob = async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await onRunWebKit(
          {
            widths: selectedWidths,
            includeWebp,
            includeJpeg,
            includeLqip,
            quality: quality / 100,
            autoContrast,
            sharpenPct,
            assetPrefix: '/images/',
            altText: 'Responsive studio image',
            sizesAttr: '(max-width: 768px) 100vw, 960px',
            baseName: sourceState.file.name,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setResult(res);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };

    if (isInitial) {
      void runExportJob();
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => {
      void runExportJob();
    }, 90);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    sourceState,
    selectedWidths,
    includeWebp,
    includeJpeg,
    includeLqip,
    quality,
    autoContrast,
    sharpenPct,
    onRunWebKit,
  ]);

  const livePictureHtml = useMemo(() => {
    if (!result) return '';
    const webpAssets = result.assets.filter((a) => a.format === 'webp');
    const fallbackAssets = result.assets.filter((a) => a.format !== 'webp');
    const last = result.assets[result.assets.length - 1];
    return buildPictureMarkup({
      prefix: assetPrefix,
      alt: altText,
      sizes: sizesAttr,
      webpAssets,
      fallbackAssets,
      width: last?.width ?? result.sourceWidth,
      height: last?.height ?? result.sourceHeight,
    });
  }, [result, assetPrefix, altText, sizesAttr]);

  function toggleWidth(w: number) {
    setSelectedWidths((prev) => {
      if (prev.includes(w)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== w);
      }
      return [...prev, w].sort((a, b) => a - b);
    });
  }

  async function handleCopyText(text: string, which: 'html' | 'lqip') {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'html') {
        setCopiedHtml(true);
        window.setTimeout(() => setCopiedHtml(false), 1800);
      } else {
        setCopiedLqip(true);
        window.setTimeout(() => setCopiedLqip(false), 1800);
      }
    } catch {
      setError('Clipboard write unavailable in this browser.');
    }
  }

  async function handleDownloadKitZip() {
    if (!result) return;
    const entries = await Promise.all(
      result.assets.map(async (asset: WebKitAsset) => ({
        name: asset.filename,
        data: new Uint8Array(await asset.blob.arrayBuffer()),
      })),
    );
    const snippetBytes = new TextEncoder().encode(`${livePictureHtml}\n`);
    entries.push({ name: 'picture-snippet.html', data: snippetBytes });
    if (result.lqipDataUri) {
      entries.push({
        name: 'lqip-data-uri.txt',
        data: new TextEncoder().encode(`${result.lqipDataUri}\n`),
      });
    }
    const zipBlob = createZipBlob(entries);
    triggerDownload(zipBlob, `${result.stem}-web-kit.zip`);
  }

  const hasFile = Boolean(sourceState && !sourceState.blockedReason);
  const totalBytes = result ? result.assets.reduce((sum, a) => sum + a.bytes, 0) : 0;
  const totalFmt = formatFileSize(totalBytes);

  return (
    <main class="studio-main">
      <section class="stage-canvas">
        {!hasFile ? (
          <div
            class={isOver ? 'drop drop-hero over' : 'drop drop-hero'}
            tabIndex={0}
            role="button"
            aria-label="Choose a hero image for Web Export Kit"
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
                <CodeIcon class="icon-lg" />
              </div>
              <h2>Generate a Responsive Web Export Kit</h2>
              <p class="drop-sub">
                Create 480w / 960w / 1600w WebP &amp; JPEG breakpoints, a blurred ~20 px LQIP data
                URI, and copy-ready &lt;picture&gt; HTML in one ZIP.
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
                  <ShieldIcon /> Never Upscales Past Source
                </span>
                <span>WebP + JPEG Fallbacks</span>
                <span>Zero Server Requests</span>
              </div>
            </div>
          </div>
        ) : (
          <div class="stage-work">
            <div class="stage-hud">
              <div class="hud-left">
                <div class="big" aria-live="polite">
                  {result ? result.assets.length : '–'}
                  <small>files</small>
                </div>
                {result && (
                  <div class="hud-badges">
                    <span class="quality-badge quality-good">
                      {totalFmt.value} {totalFmt.unit} total kit
                    </span>
                    {result.lqipDataUri && (
                      <span class="quality-badge quality-crisp">LQIP {result.lqipBytes} B</span>
                    )}
                  </div>
                )}
              </div>

              <div class="batch-actions">
                <button
                  type="button"
                  id="webKitZipBtn"
                  class="btn btn-primary"
                  disabled={!result || busy}
                  onClick={() => void handleDownloadKitZip()}
                >
                  <ArchiveIcon />
                  <span>Download kit (.zip)</span>
                </button>
              </div>
            </div>

            {error && (
              <div class="note-bar note-err" role="alert">
                <span>{error}</span>
              </div>
            )}

            <div class="card batch-table-card">
              <div class="batch-table" role="table" aria-label="Generated responsive variants">
                <div class="batch-row webkit-row batch-head" role="row">
                  <span role="columnheader">Asset</span>
                  <span role="columnheader">Format</span>
                  <span role="columnheader">Dimensions</span>
                  <span role="columnheader">Size</span>
                  <span role="columnheader">Action</span>
                </div>
                {result ? (
                  result.assets.map((asset) => {
                    const fmt = formatFileSize(asset.bytes);
                    return (
                      <div class="batch-row webkit-row" role="row" key={asset.filename}>
                        <strong class="batch-filename" role="cell">
                          {asset.filename}
                        </strong>
                        <span class="xray-pill xray-pill-ok" role="cell">
                          {asset.format.toUpperCase()}
                        </span>
                        <span class="muted" role="cell">
                          {asset.width}×{asset.height} px
                        </span>
                        <strong class="batch-size-cell" role="cell">
                          {fmt.value} {fmt.unit}
                        </strong>
                        <div class="batch-row-actions" role="cell">
                          <button
                            type="button"
                            class="tool-chip"
                            onClick={() => triggerDownload(asset.blob, asset.filename)}
                          >
                            <DownloadIcon />
                            <span>Save</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div class="inspect-thumb-placeholder">Generating responsive variants…</div>
                )}
              </div>
            </div>

            {result && (
              <div class="card stack-sm">
                <div class="row-between">
                  <h3 class="inspect-card-title m-0">Copy-ready &lt;picture&gt; HTML</h3>
                  <button
                    type="button"
                    class="tool-chip"
                    onClick={() => void handleCopyText(livePictureHtml, 'html')}
                  >
                    {copiedHtml ? <CheckIcon /> : <CopyIcon />}
                    <span>{copiedHtml ? 'Copied!' : 'Copy HTML'}</span>
                  </button>
                </div>
                <pre class="code-block">
                  <code>{livePictureHtml}</code>
                </pre>
              </div>
            )}

            {result?.lqipDataUri && (
              <div class="card stack-sm">
                <div class="row-between">
                  <h3 class="inspect-card-title m-0">
                    LQIP Blur Placeholder ({result.lqipWidth}×{result.lqipHeight} px ·{' '}
                    {result.lqipBytes} B)
                  </h3>
                  <button
                    type="button"
                    class="tool-chip"
                    onClick={() => void handleCopyText(result.lqipDataUri!, 'lqip')}
                  >
                    {copiedLqip ? <CheckIcon /> : <CopyIcon />}
                    <span>{copiedLqip ? 'Copied!' : 'Copy Data URI'}</span>
                  </button>
                </div>
                <div class="lqip-row">
                  <img
                    src={result.lqipDataUri}
                    alt="Low-quality placeholder preview"
                    class="lqip-preview"
                  />
                  <pre class="code-block code-block-sm">
                    <code>{result.lqipDataUri}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <aside class="controls-panel" aria-label="Web Export Kit settings">
        <div class="inspector-scroll">
          <fieldset class="inspector-section">
            <legend class="section-heading">Breakpoints</legend>
            <div class="kb-chips">
              {BREAKPOINT_CHOICES.map((w) => (
                <button
                  key={w}
                  type="button"
                  class={selectedWidths.includes(w) ? 'kb-chip active' : 'kb-chip'}
                  onClick={() => toggleWidth(w)}
                >
                  {w}w
                </button>
              ))}
            </div>
            <p class="hint">Widths larger than the uploaded photo are skipped without upscaling.</p>
          </fieldset>

          <fieldset class="inspector-section">
            <legend class="section-heading">Formats &amp; Quality</legend>

            <label class="switch-row">
              <span class="switch-label">Generate WebP</span>
              <input
                type="checkbox"
                class="switch-input"
                checked={includeWebp}
                onChange={(e) => {
                  const next = (e.target as HTMLInputElement).checked;
                  if (!next && !includeJpeg) return;
                  setIncludeWebp(next);
                }}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>

            <label class="switch-row">
              <span class="switch-label">Generate JPEG fallback</span>
              <input
                type="checkbox"
                class="switch-input"
                checked={includeJpeg}
                onChange={(e) => {
                  const next = (e.target as HTMLInputElement).checked;
                  if (!next && !includeWebp) return;
                  setIncludeJpeg(next);
                }}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>

            <label class="switch-row">
              <span class="switch-label">Generate ~20 px LQIP</span>
              <input
                type="checkbox"
                class="switch-input"
                checked={includeLqip}
                onChange={(e) => setIncludeLqip((e.target as HTMLInputElement).checked)}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>

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
                min={50}
                max={95}
                value={quality}
                onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))}
              />
            </label>

            <label class="switch-row">
              <span class="switch-label">Fix dull contrast</span>
              <input
                type="checkbox"
                class="switch-input"
                checked={autoContrast}
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
                onInput={(e) => setSharpenPct(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </fieldset>

          <fieldset class="inspector-section">
            <legend class="section-heading">HTML Snippet Attributes</legend>

            <label class="field-block">
              <span class="field-caption">Asset path prefix</span>
              <input
                type="text"
                class="input"
                value={assetPrefix}
                onInput={(e) => setAssetPrefix((e.target as HTMLInputElement).value)}
              />
            </label>

            <label class="field-block">
              <span class="field-caption">Alt text</span>
              <input
                type="text"
                class="input"
                value={altText}
                onInput={(e) => setAltText((e.target as HTMLInputElement).value)}
              />
            </label>

            <label class="field-block">
              <span class="field-caption">sizes attribute</span>
              <input
                type="text"
                class="input"
                value={sizesAttr}
                onInput={(e) => setSizesAttr((e.target as HTMLInputElement).value)}
              />
            </label>
          </fieldset>
        </div>

        <div class="inspector-actions">
          <button
            type="button"
            class="primary-cta"
            disabled={!result || busy}
            onClick={() => void handleDownloadKitZip()}
          >
            <ArchiveIcon />
            <span>Download kit (.zip)</span>
          </button>
          <button type="button" class="sec-btn" onClick={onChooseFile}>
            <RefreshIcon />
            <span>Replace photo</span>
          </button>
        </div>
      </aside>
    </main>
  );
}
