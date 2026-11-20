import { useRef } from 'preact/hooks';

import { formatExtension, formatFileSize } from '../engine/presets';
import type { FitMode, OutputFormat, QualityBand, ResizeCompressResult } from '../engine/types';
import { EyeIcon, PhotoIcon, ShieldIcon, SparklesIcon, UploadIcon } from './icons';
import { PlacementSimulator, SIMULATOR_OPTIONS, type SimulatorMode } from './placement-simulator';

const HERO_CHIPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'instagram-post', label: 'Instagram 1080×1080' },
  { id: 'og-image', label: 'OG Card 1200×630' },
  { id: 'youtube-thumbnail', label: 'YouTube 1280×720' },
  { id: 'ng-nysc-portal', label: 'NYSC ≤15 KB' },
  { id: 'ng-unilorin-post-utme', label: 'UNILORIN ≤25 KB' },
  { id: 'web-hero', label: 'Web Hero 1920×1080' },
];

export interface StageViewProps {
  hasFile: boolean;
  isOver: boolean;
  busy: boolean;
  comparingOriginal: boolean;
  originalUrl: string | null;
  resultUrl: string | null;
  result: ResizeCompressResult | null;
  origFileBytes: number;
  activePresetId: string;
  fit: FitMode;
  focalMode: 'auto' | 'manual';
  focalX: number;
  focalY: number;
  error: string | null;
  activeMaxKb: number | null;
  requestedFormat: OutputFormat;
  activePresetNote: string | null;
  simEnabled: boolean;
  simMode: SimulatorMode;
  onChooseFile: () => void;
  onLoadSample: () => void;
  onSelectPreset: (presetId: string) => void;
  onFocalChange: (fx: number, fy: number) => void;
  onResetAutoFocal: () => void;
  onToggleSim: () => void;
  onSimModeChange: (mode: SimulatorMode) => void;
  onSwitchToWebp: () => void;
}

function clampUnit(n: number): number {
  return Math.max(-1, Math.min(1, Number(n.toFixed(3))));
}

function qualityLabel(band: QualityBand): string {
  if (band === 'crisp') return 'Crisp quality';
  if (band === 'good') return 'Good quality';
  return 'Heavy compression';
}

export function StageView(props: StageViewProps) {
  const {
    hasFile,
    isOver,
    busy,
    comparingOriginal,
    originalUrl,
    resultUrl,
    result,
    origFileBytes,
    activePresetId,
    fit,
    focalMode,
    focalX,
    focalY,
    error,
    activeMaxKb,
    requestedFormat,
    activePresetNote,
    simEnabled,
    simMode,
    onChooseFile,
    onLoadSample,
    onSelectPreset,
    onFocalChange,
    onResetAutoFocal,
    onToggleSim,
    onSimModeChange,
    onSwitchToWebp,
  } = props;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origFx: number;
    origFy: number;
    width: number;
    height: number;
  } | null>(null);

  if (!hasFile) {
    return (
      <section class="stage-canvas">
        <div
          class={isOver ? 'drop drop-hero over' : 'drop drop-hero'}
          id="drop"
          tabIndex={0}
          role="button"
          aria-label="Choose an image"
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
              <UploadIcon class="icon-lg" />
            </div>

            <h2>Drop a photo here</h2>
            <p class="drop-sub">
              Drag &amp; drop, paste with <kbd>Ctrl+V</kbd>, or choose a file · JPG, PNG, WebP
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

            <div class="hero-chips-block" onClick={(e) => e.stopPropagation()}>
              <span class="hero-chips-label">Quick destinations</span>
              <div class="hero-chips">
                {HERO_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    class={activePresetId === chip.id ? 'hero-chip active' : 'hero-chip'}
                    onClick={() => onSelectPreset(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p class="note note-err" role="alert">
                {error}
              </p>
            )}

            <div class="hero-trust-strip">
              <span>
                <ShieldIcon /> 100% On-Device
              </span>
              <span>
                <SparklesIcon /> Auto-Contrast &amp; Sharpen
              </span>
              <span>EXIF &amp; GPS Stripped</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const displaySrc = comparingOriginal ? (originalUrl ?? resultUrl ?? '') : (resultUrl ?? '');
  const tagText = busy ? 'Working…' : comparingOriginal ? 'Original' : 'Result';
  const canPanCrop =
    fit === 'fill' && Boolean(result?.cropped) && !comparingOriginal && !simEnabled;

  let pct = 0;
  let newSizeValue = '–';
  let newSizeUnit = '';
  let origSizeLabel = '';
  if (result) {
    const formattedNew = formatFileSize(result.bytes);
    newSizeValue = formattedNew.value;
    newSizeUnit = formattedNew.unit;
    const formattedOrig = formatFileSize(origFileBytes);
    origSizeLabel = `${formattedOrig.value} ${formattedOrig.unit}`;
    pct = origFileBytes > 0 ? Math.round((1 - result.bytes / origFileBytes) * 100) : 0;
  }

  let statusNote = '';
  let statusIsError = false;
  let showWebpNudge = false;

  if (error) {
    statusNote = error;
    statusIsError = true;
  } else if (result?.shrunkToFitKb && activeMaxKb) {
    statusNote = `Shrunk to ${result.width}×${result.height} px to get under ${activeMaxKb} KB. Try WebP or a larger limit to keep more pixels.`;
    showWebpNudge = requestedFormat === 'jpeg';
  } else if (result?.status === 'infeasible-max' && activeMaxKb) {
    const curFmt = formatFileSize(result.bytes);
    statusNote = `Smallest compressed output (${curFmt.value} ${curFmt.unit}) still exceeds ${activeMaxKb} KB.`;
    showWebpNudge = requestedFormat === 'jpeg';
  } else if (result?.wasClampedToSafeArea) {
    statusNote = `Clamped to ${result.width}×${result.height} px to stay within the browser’s 16 MP safe memory ceiling.`;
  } else if (result?.qualityAssessment?.suggestWebp) {
    statusNote = `Tight ${activeMaxKb} KB limit is softening JPEG details.`;
    showWebpNudge = true;
  } else if (result && pct < 0) {
    statusNote =
      'This came out larger than the original. Choose JPEG or WebP, lower the quality, or set a max file size.';
  } else if (result && result.actualFormat !== requestedFormat) {
    statusNote = `Your browser can’t save ${requestedFormat.toUpperCase()}, so it used ${formatExtension(result.actualFormat).toUpperCase()} instead.`;
  } else if (activePresetNote) {
    statusNote = activePresetNote;
  }

  const effectiveSimMode: SimulatorMode = simEnabled
    ? simMode === 'none'
      ? 'og-card'
      : simMode
    : 'none';

  return (
    <section class="stage-canvas">
      <div class="stage-work" id="work">
        <div class="stage-hud">
          <div class="hud-left">
            <div class="big" id="newSize" aria-live="polite">
              {newSizeValue}
              {newSizeUnit && <small>{newSizeUnit}</small>}
            </div>
            {result && (
              <div class="hud-badges">
                <strong class={pct < 0 ? 'delta-pill up' : 'delta-pill'}>
                  {pct >= 0 ? `−${pct}` : `+${-pct}`}%
                </strong>
                {result.qualityAssessment && (
                  <span
                    class={`quality-badge quality-${result.qualityAssessment.band}`}
                    title={`Estimated luminance PSNR: ${result.qualityAssessment.psnr} dB`}
                  >
                    {qualityLabel(result.qualityAssessment.band)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div class="hud-right">
            {result && (
              <div class="meta" id="meta">
                <span>
                  was {origSizeLabel} · {result.originalWidth}×{result.originalHeight}
                </span>
                <span class="meta-now">
                  now {result.width}×{result.height} px, {formatExtension(result.actualFormat)}
                </span>
              </div>
            )}

            <div class="sim-toolbar">
              <button
                type="button"
                class={simEnabled ? 'sim-toggle active' : 'sim-toggle'}
                aria-pressed={simEnabled}
                onClick={onToggleSim}
              >
                <EyeIcon />
                <span>Preview in context</span>
              </button>
              {simEnabled && (
                <select
                  class="sim-select"
                  aria-label="Placement preview context"
                  value={effectiveSimMode}
                  onChange={(e) =>
                    onSimModeChange((e.target as HTMLSelectElement).value as SimulatorMode)
                  }
                >
                  {SIMULATOR_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        <div
          class={simEnabled ? 'view sim-active' : canPanCrop ? 'view can-pan' : 'view'}
          onPointerDown={(e) => {
            if (!canPanCrop) return;
            const rect = e.currentTarget.getBoundingClientRect();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = {
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              origFx: result?.appliedFocalX ?? focalX,
              origFy: result?.appliedFocalY ?? focalY,
              width: Math.max(1, rect.width),
              height: Math.max(1, rect.height),
            };
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;
            const dx = ((e.clientX - drag.startX) / drag.width) * 2;
            const dy = ((e.clientY - drag.startY) / drag.height) * 2;
            onFocalChange(clampUnit(drag.origFx - dx), clampUnit(drag.origFy - dy));
          }}
          onPointerUp={(e) => {
            if (dragRef.current?.pointerId === e.pointerId) {
              dragRef.current = null;
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          <PlacementSimulator mode={effectiveSimMode}>
            {displaySrc && <img id="img" src={displaySrc} alt="Resized preview" />}
          </PlacementSimulator>
          <span class="tag" id="tag">
            {tagText}
          </span>
          {canPanCrop && (
            <button
              type="button"
              class={focalMode === 'manual' ? 'crop-hint active' : 'crop-hint'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (focalMode === 'manual') onResetAutoFocal();
              }}
            >
              {focalMode === 'manual' ? 'Reset to auto-frame' : 'Auto-framed · Drag to adjust'}
            </button>
          )}
        </div>

        {statusNote && (
          <div
            class={
              statusIsError
                ? 'note-bar note-err'
                : activePresetNote
                  ? 'note-bar note-info'
                  : 'note-bar'
            }
            id="note"
            role="status"
          >
            <span>{statusNote}</span>
            {showWebpNudge && (
              <button type="button" class="btn-inline-action" onClick={onSwitchToWebp}>
                Switch to WebP
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
