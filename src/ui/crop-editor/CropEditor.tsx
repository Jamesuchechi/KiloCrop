import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { clampCropRect, resolveOutputDimensions } from '../../engine/geometry';
import type { BitmapLike, Dimensions, InspectReport, Rect, Spec } from '../../engine/types';

export interface CropEditorProps {
  bitmap: BitmapLike | null;
  orientedDims: Dimensions | null;
  spec: Spec;
  inspectReport: InspectReport | null;
  busy: boolean;
  error: string | null;
  onFitPhoto: (cropRect: Rect) => void;
  onChangePhoto: () => void;
}

interface ViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

function computeFrame(stageW: number, stageH: number, aspect: number) {
  const pad = 20;
  const maxW = Math.max(80, stageW - pad * 2);
  const maxH = Math.max(80, stageH - pad * 2);
  let fw = maxW;
  let fh = fw / aspect;
  if (fh > maxH) {
    fh = maxH;
    fw = fh * aspect;
  }
  const fx = (stageW - fw) / 2;
  const fy = (stageH - fh) / 2;
  return { fx, fy, fw, fh };
}

export function CropEditor(props: CropEditorProps) {
  const { bitmap, orientedDims, spec, inspectReport, busy, error, onFitPhoto, onChangePhoto } =
    props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ViewState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const [stageSize, setStageSize] = useState({ width: 340, height: 340 });
  const [zoomLabel, setZoomLabel] = useState(1);
  const [showGuide, setShowGuide] = useState(true);

  const outDims = useMemo(() => resolveOutputDimensions(spec), [spec]);
  const targetAspect = outDims.width / outDims.height;
  const blockingIssue = inspectReport?.issues.find((i) => i.severity === 'blocking') ?? null;
  const advisoryIssues = inspectReport?.issues.filter((i) => i.severity === 'advisory') ?? [];

  const clampOffsets = useCallback(
    (zoom: number, ox: number, oy: number) => {
      if (!bitmap) return { offsetX: 0, offsetY: 0 };
      const { fw, fh } = computeFrame(stageSize.width, stageSize.height, targetAspect);
      const coverScale = Math.max(fw / bitmap.width, fh / bitmap.height);
      const scale = coverScale * zoom;
      const maxX = Math.max(0, (bitmap.width * scale - fw) / 2);
      const maxY = Math.max(0, (bitmap.height * scale - fh) / 2);
      return {
        offsetX: Math.max(-maxX, Math.min(maxX, ox)),
        offsetY: Math.max(-maxY, Math.min(maxY, oy)),
      };
    },
    [bitmap, stageSize.height, stageSize.width, targetAspect],
  );

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { width: stageW, height: stageH } = stageSize;
    if (canvas.width !== Math.round(stageW * dpr) || canvas.height !== Math.round(stageH * dpr)) {
      canvas.width = Math.round(stageW * dpr);
      canvas.height = Math.round(stageH * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, stageW, stageH);

    const { fx, fy, fw, fh } = computeFrame(stageW, stageH, targetAspect);

    if (bitmap) {
      const { zoom, offsetX, offsetY } = viewRef.current;
      const coverScale = Math.max(fw / bitmap.width, fh / bitmap.height);
      const scale = coverScale * zoom;
      const dw = bitmap.width * scale;
      const dh = bitmap.height * scale;
      const dx = fx + fw / 2 + offsetX - dw / 2;
      const dy = fy + fh / 2 + offsetY - dh / 2;
      ctx.drawImage(bitmap as unknown as CanvasImageSource, dx, dy, dw, dh);
    }

    // Dimmed outer scrim outside the crop box
    ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
    ctx.fillRect(0, 0, stageW, fy);
    ctx.fillRect(0, fy + fh, stageW, stageH - (fy + fh));
    ctx.fillRect(0, fy, fx, fh);
    ctx.fillRect(fx + fw, fy, stageW - (fx + fw), fh);

    // Crisp crop frame border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(fx, fy, fw, fh);

    // Subtle thirds guide
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx + fw / 3, fy);
    ctx.lineTo(fx + fw / 3, fy + fh);
    ctx.moveTo(fx + (fw * 2) / 3, fy);
    ctx.lineTo(fx + (fw * 2) / 3, fy + fh);
    ctx.moveTo(fx, fy + fh / 3);
    ctx.lineTo(fx + fw, fy + fh / 3);
    ctx.moveTo(fx, fy + (fh * 2) / 3);
    ctx.lineTo(fx + fw, fy + (fh * 2) / 3);
    ctx.stroke();

    if (showGuide) {
      const [hMin, hMax] = spec.framing?.headHeightPct ?? [65, 80];
      const [eMin, eMax] = spec.framing?.eyeLineFromTopPct ?? [40, 50];
      const headPct = (hMin + hMax) / 200;
      const eyePct = (eMin + eMax) / 200;

      const ovalH = fh * headPct;
      const ovalW = Math.min(fw * 0.72, ovalH * 0.72);
      const eyeY = fy + fh * eyePct;
      const ovalCenterY = eyeY + ovalH * 0.05;

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(fx + fw / 2, ovalCenterY, ovalW / 2, ovalH / 2, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Eye-line band
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.85)';
      ctx.beginPath();
      ctx.moveTo(fx + fw * 0.15, eyeY);
      ctx.lineTo(fx + fw * 0.85, eyeY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [bitmap, showGuide, spec.framing, stageSize, targetAspect]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawFrame();
    });
  }, [drawFrame]);

  useEffect(() => {
    const el = canvasRef.current ?? stageRef.current;
    if (!el) return;
    const syncSize = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw > 0 && ch > 0) {
        setStageSize({ width: Math.round(cw), height: Math.round(ch) });
      }
    };
    syncSize();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setStageSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    viewRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
    setZoomLabel(1);
    scheduleDraw();
  }, [bitmap, targetAspect, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleDraw, showGuide, stageSize]);

  function applyZoom(nextZoomRaw: number) {
    const nextZoom = Math.max(1, Math.min(4, Number(nextZoomRaw.toFixed(2))));
    const clamped = clampOffsets(nextZoom, viewRef.current.offsetX, viewRef.current.offsetY);
    viewRef.current = { zoom: nextZoom, ...clamped };
    setZoomLabel(nextZoom);
    scheduleDraw();
  }

  function resetView() {
    viewRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
    setZoomLabel(1);
    scheduleDraw();
  }

  function computeSourceCropRect(): Rect | null {
    if (!bitmap) return null;
    const { fx, fy, fw, fh } = computeFrame(stageSize.width, stageSize.height, targetAspect);
    const { zoom, offsetX, offsetY } = viewRef.current;
    const coverScale = Math.max(fw / bitmap.width, fh / bitmap.height);
    const scale = coverScale * zoom;
    const imgLeft = fx + fw / 2 + offsetX - (bitmap.width * scale) / 2;
    const imgTop = fy + fh / 2 + offsetY - (bitmap.height * scale) / 2;

    const previewX = (fx - imgLeft) / scale;
    const previewY = (fy - imgTop) / scale;
    const previewW = fw / scale;
    const previewH = fh / scale;

    const fullDims = orientedDims ?? { width: bitmap.width, height: bitmap.height };
    const sx = fullDims.width / bitmap.width;
    const sy = fullDims.height / bitmap.height;

    return clampCropRect(
      {
        x: previewX * sx,
        y: previewY * sy,
        width: previewW * sx,
        height: previewH * sy,
      },
      fullDims,
    );
  }

  function handlePointerDown(e: PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      pinchStartRef.current = { dist, zoom: viewRef.current.zoom };
    }
  }

  function handlePointerMove(e: PointerEvent) {
    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, cur);

    if (pointersRef.current.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const clamped = clampOffsets(
        viewRef.current.zoom,
        viewRef.current.offsetX + dx,
        viewRef.current.offsetY + dy,
      );
      viewRef.current = { ...viewRef.current, ...clamped };
      scheduleDraw();
    } else if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (pinchStartRef.current.dist > 0) {
        applyZoom(pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist));
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const c = clampOffsets(
        viewRef.current.zoom,
        viewRef.current.offsetX - step,
        viewRef.current.offsetY,
      );
      viewRef.current = { ...viewRef.current, ...c };
      scheduleDraw();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const c = clampOffsets(
        viewRef.current.zoom,
        viewRef.current.offsetX + step,
        viewRef.current.offsetY,
      );
      viewRef.current = { ...viewRef.current, ...c };
      scheduleDraw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const c = clampOffsets(
        viewRef.current.zoom,
        viewRef.current.offsetX,
        viewRef.current.offsetY - step,
      );
      viewRef.current = { ...viewRef.current, ...c };
      scheduleDraw();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const c = clampOffsets(
        viewRef.current.zoom,
        viewRef.current.offsetX,
        viewRef.current.offsetY + step,
      );
      viewRef.current = { ...viewRef.current, ...c };
      scheduleDraw();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      applyZoom(viewRef.current.zoom + 0.15);
    } else if (e.key === '-') {
      e.preventDefault();
      applyZoom(viewRef.current.zoom - 0.15);
    } else if (e.key === '0') {
      e.preventDefault();
      resetView();
    }
  }

  return (
    <section class="card stack">
      <div class="row-between">
        <div>
          <strong>Crop for {spec.shortLabel ?? spec.title}</strong>
          <div class="muted">
            Target: {outDims.width}×{outDims.height} px
            {spec.output.fileSizeKb.max ? ` · ≤ ${spec.output.fileSizeKb.max} KB` : ''}
          </div>
        </div>
        <button type="button" class="btn-link" onClick={onChangePhoto}>
          Change photo
        </button>
      </div>

      {blockingIssue && (
        <div class="banner banner-err" role="alert">
          <strong>{blockingIssue.title}:</strong> {blockingIssue.detail}
        </div>
      )}

      {advisoryIssues.map((issue) => (
        <div key={issue.code} class="banner banner-warn">
          <strong>{issue.title}:</strong> {issue.detail}
        </div>
      ))}

      {error && (
        <div class="banner banner-err" role="alert">
          {error}
        </div>
      )}

      {!blockingIssue && (
        <>
          <div ref={stageRef} class="crop-stage">
            <canvas
              ref={canvasRef}
              tabIndex={0}
              role="application"
              aria-label="Photo crop frame. Drag or use arrow keys to move, pinch or plus and minus keys to zoom."
              class="crop-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={(e) => {
                e.preventDefault();
                applyZoom(viewRef.current.zoom + (e.deltaY < 0 ? 0.12 : -0.12));
              }}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div class="controls-row">
            <label class="zoom-label">
              <span>Zoom {zoomLabel.toFixed(1)}×</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={zoomLabel}
                onInput={(e) => applyZoom(Number((e.target as HTMLInputElement).value))}
              />
            </label>
            <button type="button" class="btn btn-sm" onClick={() => setShowGuide((g) => !g)}>
              Guide: {showGuide ? 'On' : 'Off'}
            </button>
            <button type="button" class="btn btn-sm" onClick={resetView}>
              Reset
            </button>
          </div>

          <p class="muted m-0" aria-live="polite">
            Drag to center your face inside the oval · Zoom {zoomLabel.toFixed(1)}×
          </p>

          <button
            type="button"
            class="btn btn-primary"
            disabled={!bitmap || busy}
            onClick={() => {
              const rect = computeSourceCropRect();
              if (rect) onFitPhoto(rect);
            }}
          >
            {busy ? 'Fitting & compressing…' : 'Fit & Save Photo'}
          </button>
        </>
      )}
    </section>
  );
}
