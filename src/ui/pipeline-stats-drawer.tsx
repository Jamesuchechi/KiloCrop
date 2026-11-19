import { useState } from 'preact/hooks';

import type { PipelineStats } from '../engine/types';

// Replace with a zero-login Tally/Google Form URL before wide consumer launch so non-devs can report stale limits without a GitHub account.
const REPORT_LIMIT_URL =
  'https://github.com/Jamesuchechi/KiloCrop/issues/new?title=Wrong+portal+limit';

export interface PipelineStatsDrawerProps {
  stats: PipelineStats | null;
  engineMode: 'worker' | 'main-thread';
}

export function PipelineStatsDrawer(props: PipelineStatsDrawerProps) {
  const { stats, engineMode } = props;
  const [open, setOpen] = useState(false);

  return (
    <footer class="footer">
      <div class="footer-line">
        <span>Offline-ready · 0 B sent</span>
        <span>·</span>
        <button
          type="button"
          class="btn-link"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Pipeline stats
        </button>
        <span>·</span>
        <a class="btn-link" href={REPORT_LIMIT_URL} target="_blank" rel="noopener noreferrer">
          Report a wrong limit
        </a>
        <span>·</span>
        <a class="btn-link" href="/guides/">
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
                decode {stats.decodeMs} ms · encode {stats.encodeMs} ms · total {stats.totalMs} ms
              </dd>
              <dt>Size reduction</dt>
              <dd>
                {(stats.inputBytes / 1024).toFixed(0)} KB → {(stats.outputBytes / 1024).toFixed(1)}{' '}
                KB ({stats.outputWidth}×{stats.outputHeight} px)
              </dd>
              <dt>JPEG search</dt>
              <dd>
                {stats.iterations} steps · q={stats.quality.toFixed(2)} · Baseline sRGB · EXIF
                stripped
              </dd>
              <dt>Network bytes sent</dt>
              <dd>{stats.outboundBytes} B</dd>
            </dl>
          ) : (
            <p class="muted m-0">
              Engine mode: <code>{engineMode}</code> · Outbound bytes: <code>0 B</code>. Process a
              photo to inspect decode/encode timings.
            </p>
          )}
        </div>
      )}
    </footer>
  );
}
