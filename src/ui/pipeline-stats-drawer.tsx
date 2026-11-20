import { useState } from 'preact/hooks';

import type { ResizeCompressStats } from '../engine/types';
import { appHref } from './base-url';

// Replace with a zero-login Tally/Google Form URL before wide consumer launch so non-devs can report stale limits without a GitHub account.
const REPORT_LIMIT_URL =
  'https://github.com/Jamesuchechi/KiloCrop/issues/new?title=Wrong+portal+limit';

export interface PipelineStatsDrawerProps {
  stats: ResizeCompressStats | null;
  engineMode: 'worker' | 'main-thread';
}

export function PipelineStatsDrawer(props: PipelineStatsDrawerProps) {
  const { stats, engineMode } = props;
  const [open, setOpen] = useState(false);

  return (
    <footer class="footer">
      <div class="footer-line">
        <span class="footer-text">Offline-ready · 0 B sent</span>
        <span class="footer-sep" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          class="btn-link"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Pipeline stats
        </button>
        <span class="footer-sep" aria-hidden="true">
          ·
        </span>
        <a class="btn-link" href={REPORT_LIMIT_URL} target="_blank" rel="noopener noreferrer">
          Report a wrong limit
        </a>
        <span class="footer-sep" aria-hidden="true">
          ·
        </span>
        <a class="btn-link" href={appHref('/guides/')}>
          Portal guides
        </a>
      </div>

      {open && (
        <div class="stats-drawer" role="region" aria-label="Pipeline telemetry">
          <div class="row-between mb-xs">
            <strong>Local Pipeline Telemetry</strong>
            <button type="button" class="btn-link" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {stats ? (
            <dl class="stats-dl">
              <dt>Execution</dt>
              <dd>{engineMode} (same-origin static files only)</dd>
              <dt>Timing</dt>
              <dd>
                scale {stats.decodeMs} ms · enhance {stats.enhanceMs} ms · encode {stats.encodeMs}{' '}
                ms · total {stats.totalMs} ms
              </dd>
              <dt>Size reduction</dt>
              <dd>
                {(stats.inputBytes / 1024).toFixed(0)} KB ({stats.originalWidth}×
                {stats.originalHeight}) → {(stats.outputBytes / 1024).toFixed(1)} KB (
                {stats.outputWidth}×{stats.outputHeight} px)
              </dd>
              <dt>Encoding</dt>
              <dd>
                {stats.format.toUpperCase()} · {stats.iterations} steps · q=
                {stats.quality.toFixed(2)} · EXIF stripped
              </dd>
              <dt>Enhancement</dt>
              <dd>
                contrast {stats.contrastApplied ? 'enhanced' : 'unchanged'} · sharpen{' '}
                {stats.sharpenApplied ? 'applied' : 'off'}
              </dd>
              {stats.fixedIssues.length > 0 && (
                <>
                  <dt>Auto-fixed</dt>
                  <dd>{stats.fixedIssues.join(', ')}</dd>
                </>
              )}
              <dt>Network bytes sent</dt>
              <dd>{stats.outboundBytes} B</dd>
            </dl>
          ) : (
            <p class="muted m-0">
              Engine mode: <code>{engineMode}</code> · Outbound bytes: <code>0 B</code>. Drop or
              choose an image to inspect scale, enhance, and encode timings.
            </p>
          )}
        </div>
      )}
    </footer>
  );
}
