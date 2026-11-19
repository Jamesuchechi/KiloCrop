import { useMemo } from 'preact/hooks';

import { buildDownloadFilename } from '../engine/specs';
import type { EncodeResult, InspectReport, PipelineStats, Spec } from '../engine/types';

export interface ResultViewProps {
  spec: Spec;
  result: EncodeResult;
  stats: PipelineStats;
  report: InspectReport;
  previewUrl: string;
  linkCopied: boolean;
  onSharePortalLink: () => void;
  onOpenPrintSheet: () => void;
  onRecrop: () => void;
  onNewPhoto: () => void;
}

export function ResultView(props: ResultViewProps) {
  const {
    spec,
    result,
    stats,
    report,
    previewUrl,
    linkCopied,
    onSharePortalLink,
    onOpenPrintSheet,
    onRecrop,
    onNewPhoto,
  } = props;

  const filename = useMemo(
    () => buildDownloadFilename(spec, result.bytes, spec.output.format),
    [spec, result.bytes],
  );
  const advisoryIssues = report.issues.filter((i) => i.severity === 'advisory');
  const outKb = (result.bytes / 1024).toFixed(1);
  const inKb = (stats.inputBytes / 1024).toFixed(0);

  const canNativeShare = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
    try {
      const probe = new File([result.blob], filename, { type: result.blob.type });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }, [filename, result.blob]);

  async function handleShareFile() {
    const file = new File([result.blob], filename, { type: result.blob.type || 'image/jpeg' });
    try {
      await navigator.share({ files: [file], title: `${spec.shortLabel ?? spec.title} photo` });
    } catch {
      // User cancelled share sheet; ignore cleanly.
    }
  }

  return (
    <section class="workbench">
      <div class="card stage-card stack">
        <div class="stage-head">
          <span class="stage-title">Export Preview</span>
          <span>
            {inKb} KB → {outKb} KB
          </span>
        </div>

        <div class="stage-well result-preview-wrap">
          <img src={previewUrl} alt="Exported portal photo preview" class="result-img" />
          <div class="stage-pills">
            <span class="stage-pill">
              {result.width}×{result.height} px
            </span>
            <span class="stage-pill">{outKb} KB</span>
            <span class="stage-pill">{spec.output.format.toUpperCase()}</span>
            {result.dpi && <span class="stage-pill">{result.dpi} DPI</span>}
          </div>
        </div>
      </div>

      <div class="card stack">
        <div class="xray-card">
          <div class="xray-title">
            {stats.fixedIssues.length > 0 ? (
              <strong>
                Fixed {stats.fixedIssues.length} hidden{' '}
                {stats.fixedIssues.length === 1 ? 'issue' : 'issues'}
              </strong>
            ) : (
              <strong>Ready — EXIF stripped &amp; baseline encoded</strong>
            )}
            <span class="badge badge-ok">{outKb} KB</span>
          </div>
          {stats.fixedIssues.length > 0 && (
            <ul class="xray-list">
              {stats.fixedIssues.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        {result.status === 'infeasible-max' && (
          <div class="banner banner-err" role="alert">
            Could not squeeze below {spec.output.fileSizeKb.max} KB at exact {result.width}×
            {result.height} px without severe blur (reached {outKb} KB). Try relaxing pixels or KB
            cap in <strong>Paste rule / Custom</strong>.
          </div>
        )}

        {result.status === 'padded-min' && (
          <div class="banner banner-ok">
            Added harmless JPEG comment metadata (+{result.paddedBytes} B, zero pixel edits) so your
            photo meets the {spec.output.fileSizeKb.min} KB minimum requirement.
          </div>
        )}

        {advisoryIssues.map((issue) => (
          <div key={issue.code} class="banner banner-warn">
            <strong>{issue.title}:</strong> {issue.detail}
          </div>
        ))}

        <div class="action-grid">
          <a href={previewUrl} download={filename} class="btn btn-primary">
            Save photo ({outKb} KB)
          </a>
          {canNativeShare && (
            <button type="button" class="btn btn-sec" onClick={handleShareFile}>
              Share photo
            </button>
          )}
          <button type="button" class="btn btn-sec" onClick={onSharePortalLink}>
            {linkCopied ? 'Portal link copied!' : 'Share this portal link'}
          </button>
          <button type="button" class="btn btn-sec" onClick={onOpenPrintSheet}>
            Make 4×6 Print Sheet
          </button>
        </div>

        <div class="wa-tip">
          <strong>Sending on WhatsApp to a café or laptop?</strong>
          <ol>
            <li>
              Tap <strong>Attach (📎) → Document</strong> (not Gallery, or WhatsApp shrinks it).
            </li>
            <li>
              Pick <code>{filename}</code> from Downloads.
            </li>
          </ol>
        </div>

        <div class="row-between">
          <button type="button" class="btn-link" onClick={onRecrop}>
            ← Adjust crop
          </button>
          <button type="button" class="btn-link" onClick={onNewPhoto}>
            Try another photo
          </button>
        </div>
      </div>
    </section>
  );
}
