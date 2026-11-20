import { useState } from 'preact/hooks';

import { formatFileSize } from '../../engine/presets';
import type { InspectReport } from '../../engine/types';
import { DownloadIcon, PhotoIcon, ResizeIcon, XRayIcon } from '../icons';

export interface InspectPageProps {
  file: File | null;
  report: InspectReport | null;
  origUrl: string | null;
  blockingError: string | null;
  isOver: boolean;
  onChooseFile: () => void;
  onOpenInResizer: () => void;
  onCleanDownload: () => Promise<void>;
}

function iccLabel(profile: InspectReport['iccProfile']): string {
  if (profile === 'srgb') return 'sRGB (standard web/portal safe)';
  if (profile === 'display-p3') return 'Display-P3 wide gamut';
  if (profile === 'other') return 'Embedded non-sRGB ICC profile';
  return 'Untagged / standard RGB';
}

export function InspectPage(props: InspectPageProps) {
  const {
    file,
    report,
    origUrl,
    blockingError,
    isOver,
    onChooseFile,
    onOpenInResizer,
    onCleanDownload,
  } = props;

  const [cleaning, setCleaning] = useState(false);
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);
  const [cleanError, setCleanError] = useState<string | null>(null);

  async function handleClean() {
    setCleaning(true);
    setCleanNotice(null);
    setCleanError(null);
    try {
      await onCleanDownload();
      setCleanNotice(
        'Clean baseline file downloaded (EXIF, GPS coordinates, and progressive scans stripped).',
      );
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleaning(false);
    }
  }

  if (!report || !file) {
    return (
      <section class="inspect-empty">
        <div
          class={isOver ? 'drop drop-hero over' : 'drop drop-hero'}
          tabIndex={0}
          role="button"
          aria-label="Choose an image to inspect"
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
              <XRayIcon class="icon-lg" />
            </div>
            <h2>Drop an image for X-Ray inspection</h2>
            <p class="drop-sub">
              Check EXIF/GPS privacy leaks, progressive JPEG scans, ICC profiles, and extension
              mismatches — 100% offline.
            </p>
            <div class="hero-cta-row" onClick={(e) => e.stopPropagation()}>
              <button type="button" class="hero-btn-primary" onClick={onChooseFile}>
                <PhotoIcon />
                <span>Inspect an image</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const sizeFmt = formatFileSize(report.fileBytes);
  const hasBlocking = report.issues.some((i) => i.severity === 'blocking');

  return (
    <section class="inspect-page stack">
      <div class="card row-between">
        <div>
          <h2 class="inspect-heading">Binary Image X-Ray &amp; Privacy Check</h2>
          <p class="muted m-0">
            Zero-dependency header inspection of <strong>{file.name}</strong> ({sizeFmt.value}{' '}
            {sizeFmt.unit}). Runs strictly in-browser memory.
          </p>
        </div>
        <div class="inspect-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={cleaning || hasBlocking}
            onClick={() => void handleClean()}
          >
            <DownloadIcon />
            <span>{cleaning ? 'Stripping metadata…' : 'Strip metadata & download clean copy'}</span>
          </button>
          <button type="button" class="btn btn-sec" onClick={onOpenInResizer}>
            <ResizeIcon />
            <span>Open in Resize &amp; Compress</span>
          </button>
          <button type="button" class="btn btn-sec" onClick={onChooseFile}>
            Inspect another image
          </button>
        </div>
      </div>

      {blockingError && (
        <div class="banner banner-err" role="alert">
          {blockingError}
        </div>
      )}
      {cleanError && (
        <div class="banner banner-err" role="alert">
          {cleanError}
        </div>
      )}
      {cleanNotice && (
        <div class="banner banner-ok" role="status">
          {cleanNotice}
        </div>
      )}

      <div class="inspect-grid">
        <div class="card inspect-thumb-card">
          {origUrl && !hasBlocking ? (
            <img src={origUrl} alt="Inspected source preview" class="inspect-thumb" />
          ) : (
            <div class="inspect-thumb-placeholder">
              Preview unavailable for {report.container.toUpperCase()}
            </div>
          )}
        </div>

        <div class="stack">
          <div class="inspect-cards">
            <div class="card">
              <h3 class="inspect-card-title">Format &amp; Dimensions</h3>
              <dl class="xray-dl">
                <dt>True container</dt>
                <dd>{report.container.toUpperCase()} (header magic bytes)</dd>
                <dt>Raw pixel grid</dt>
                <dd>
                  {report.rawDimensions
                    ? `${report.rawDimensions.width}×${report.rawDimensions.height} px`
                    : 'Determined on decode'}
                </dd>
                <dt>Upright dimensions</dt>
                <dd>
                  {report.orientedDimensions
                    ? `${report.orientedDimensions.width}×${report.orientedDimensions.height} px`
                    : 'Determined on decode'}
                </dd>
              </dl>
            </div>

            <div class="card">
              <h3 class="inspect-card-title">Privacy &amp; EXIF Metadata</h3>
              <dl class="xray-dl">
                <dt>EXIF segment</dt>
                <dd>{report.hasExif ? 'Present (stripped on export)' : 'None detected'}</dd>
                <dt>GPS location tags</dt>
                <dd>
                  {report.hasGpsExif ? (
                    <span class="xray-pill xray-pill-warn">
                      GPS IFD present — strip recommended
                    </span>
                  ) : (
                    <span class="xray-pill xray-pill-ok">No GPS tags found</span>
                  )}
                </dd>
                <dt>EXIF orientation</dt>
                <dd>
                  {report.orientation === 1
                    ? '1 (upright pixels)'
                    : `${report.orientation} (sideways camera rotation)`}
                </dd>
              </dl>
            </div>

            <div class="card">
              <h3 class="inspect-card-title">Compatibility &amp; Color</h3>
              <dl class="xray-dl">
                <dt>JPEG encoding</dt>
                <dd>
                  {report.container === 'jpeg'
                    ? report.isProgressiveJpeg
                      ? 'Progressive (SOF2) — may fail strict portals'
                      : 'Baseline JPEG (SOF0)'
                    : 'N/A'}
                </dd>
                <dt>Color space</dt>
                <dd>{report.isCmyk ? 'CMYK 4-channel' : iccLabel(report.iccProfile)}</dd>
              </dl>
            </div>
          </div>

          <div class="card">
            <h3 class="inspect-card-title">Diagnostic Findings ({report.issues.length})</h3>
            {report.issues.length === 0 ? (
              <p class="muted m-0">
                No hidden portal compatibility traps or EXIF rotation anomalies detected.
              </p>
            ) : (
              <ul class="issue-list">
                {report.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.title}`} class="issue-item">
                    <div class="row-between">
                      <strong>{issue.title}</strong>
                      <span
                        class={`xray-pill ${
                          issue.severity === 'blocking'
                            ? 'xray-pill-err'
                            : issue.severity === 'advisory'
                              ? 'xray-pill-warn'
                              : 'xray-pill-ok'
                        }`}
                      >
                        {issue.severity === 'blocking'
                          ? 'Unsupported'
                          : issue.severity === 'advisory'
                            ? 'Advisory'
                            : 'Auto-fixed on export'}
                      </span>
                    </div>
                    <p class="muted m-0">{issue.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
