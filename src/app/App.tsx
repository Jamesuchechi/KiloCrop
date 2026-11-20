import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import bundleData from '../../specs/bundle.json';
import { MAX_INPUT_BYTES } from '../engine/decode';
import { resolveOutputDimensions } from '../engine/geometry';
import { buildPresetCatalog, formatOutputFilename } from '../engine/presets';
import type { PrintSheetInput } from '../engine/print-sheet';
import {
  buildRecipeQuery,
  parsePortalRule,
  parseQueryFit,
  parseQuerySpec,
  parseRecipeQuery,
} from '../engine/rule-parser';
import type {
  DocumentCleanOptions,
  DocumentCleanResult,
  FitMode,
  InspectReport,
  OutputFormat,
  PadBackdropStyle,
  PrintSheetLayout,
  PrintSheetResult,
  ResizeCompressOptions,
  ResizeCompressResult,
  ResizeCompressStats,
  SizePreset,
  Spec,
  WebKitOptions,
  WebKitResult,
} from '../engine/types';
import { ControlPanel } from '../ui/control-panel';
import { appHref } from '../ui/base-url';
import {
  BookIcon,
  CodeIcon,
  DocumentIcon,
  GridIcon,
  LayersIcon,
  MoonIcon,
  PrinterIcon,
  ResizeIcon,
  SplitCompareIcon,
  SunIcon,
  XRayIcon,
} from '../ui/icons';
import { PipelineStatsDrawer } from '../ui/pipeline-stats-drawer';
import { defaultSimulatorForPreset, type SimulatorMode } from '../ui/placement-simulator';
import { deleteCustomPreset, loadSavedPresets, saveCustomPreset } from '../ui/saved-presets';
import { StageView } from '../ui/stage-view';
import { createEngineClient } from '../workers/client';
import type { EngineClient } from '../workers/protocol';
import { consumeSharedTargetFile, subscribeLaunchFiles } from './pwa-launch';
import { createLazyComponent, useRoute } from './router';

const BUNDLED_SPECS = bundleData as Spec[];

const LazyPrintSheetView = createLazyComponent(() =>
  import('../ui/print-sheet-view').then((m) => m.PrintSheetView),
);
const LazyInspectPage = createLazyComponent(() =>
  import('../ui/pages/inspect-page').then((m) => m.InspectPage),
);
const LazyBatchPage = createLazyComponent(() =>
  import('../ui/pages/batch-page').then((m) => m.BatchPage),
);
const LazyComparePage = createLazyComponent(() =>
  import('../ui/pages/compare-page').then((m) => m.ComparePage),
);
const LazyDocumentsPage = createLazyComponent(() =>
  import('../ui/pages/documents-page').then((m) => m.DocumentsPage),
);
const LazyPresetsPage = createLazyComponent(() =>
  import('../ui/pages/presets-page').then((m) => m.PresetsPage),
);
const LazyWebKitPage = createLazyComponent(() =>
  import('../ui/pages/web-kit-page').then((m) => m.WebKitPage),
);

type ThemePreference = 'system' | 'light' | 'dark';

interface InitialRuleState {
  activePresetId: string;
  widthStr: string;
  heightStr: string;
  fit: FitMode;
  format: OutputFormat;
  minKb: number | null;
  maxKbStr: string;
  dpi: number | null;
  sharedRuleTitle: string | null;
}

function resolveInitialState(presets: readonly SizePreset[]): InitialRuleState {
  const params = new URLSearchParams(window.location.search);
  const specId = params.get('spec')?.trim().toLowerCase();
  if (specId) {
    const matched = presets.find((p) => p.id.toLowerCase() === specId);
    if (matched) {
      return {
        activePresetId: matched.id,
        widthStr: matched.width ? String(matched.width) : '',
        heightStr: matched.height ? String(matched.height) : '',
        fit: matched.fit,
        format: matched.format ?? 'jpeg',
        minKb: matched.minKb ?? null,
        maxKbStr: matched.maxKb ? String(matched.maxKb) : '',
        dpi: matched.dpi ?? null,
        sharedRuleTitle: null,
      };
    }
  }

  const shared = parseQuerySpec(window.location.search);
  if (shared) {
    const resolved = resolveOutputDimensions(shared);
    return {
      activePresetId: 'custom',
      widthStr: String(resolved.width),
      heightStr: String(resolved.height),
      fit: parseQueryFit(window.location.search) ?? 'fill',
      format: shared.output.format,
      minKb: shared.output.fileSizeKb.min,
      maxKbStr: shared.output.fileSizeKb.max ? String(shared.output.fileSizeKb.max) : '',
      dpi: resolved.dpi,
      sharedRuleTitle: shared.title,
    };
  }

  const recipe = parseRecipeQuery(window.location.search);
  if (recipe) {
    return {
      activePresetId: 'custom',
      widthStr: recipe.width ? String(recipe.width) : '',
      heightStr: recipe.height ? String(recipe.height) : '',
      fit: recipe.fit ?? 'inside',
      format: recipe.format ?? 'jpeg',
      minKb: recipe.minKb,
      maxKbStr: recipe.maxKb ? String(recipe.maxKb) : '',
      dpi: recipe.dpi,
      sharedRuleTitle: recipe.title ?? 'Shared Custom Rule',
    };
  }

  return {
    activePresetId: 'custom',
    widthStr: '',
    heightStr: '',
    fit: 'inside',
    format: 'jpeg',
    minKb: null,
    maxKbStr: '',
    dpi: null,
    sharedRuleTitle: null,
  };
}

function parseOptionalPositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

async function blobToPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    ctx.drawImage(bmp, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('Clipboard PNG conversion failed'))),
        'image/png',
      );
    });
  } finally {
    bmp.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function createSampleStudioFile(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1200;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    // Deep Royal Blue atmospheric backdrop
    const sky = ctx.createLinearGradient(0, 0, 1600, 1200);
    sky.addColorStop(0, '#0f172a');
    sky.addColorStop(0.55, '#1d4ed8');
    sky.addColorStop(1, '#3b82f6');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1600, 1200);

    // Subtle geometric studio glow
    const glow = ctx.createRadialGradient(800, 440, 40, 800, 440, 560);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1600, 1200);

    // Subtle crisp drafting horizon lines to demonstrate sharpening
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    for (let y = 160; y < 1100; y += 80) {
      ctx.beginPath();
      ctx.moveTo(140, y);
      ctx.lineTo(1460, y);
      ctx.stroke();
    }

    // Center portrait subject silhouette with bright highlights
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(800, 430, 148, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(540, 960);
    ctx.quadraticCurveTo(560, 620, 800, 620);
    ctx.quadraticCurveTo(1040, 620, 1060, 960);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#111827';
    ctx.fillRect(280, 960, 1040, 140);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KiloCrop Studio Sample · 1600×1200', 800, 1044);

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Sample encode failed'))),
        'image/jpeg',
        0.92,
      ),
    );
    return new File([blob], 'studio-sample-portrait.jpg', { type: 'image/jpeg' });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function createSampleDocumentFile(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    // Warm paper sheet base
    ctx.fillStyle = '#ede8dc';
    ctx.fillRect(0, 0, 1200, 900);

    // Certificate frame & crisp typography
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 5;
    ctx.strokeRect(56, 56, 1088, 788);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OFFICIAL CERTIFICATE STATEMENT', 600, 150);

    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText('ACADEMIC TRANSCRIPT & CREDENTIAL RECORD', 600, 210);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.font = '24px system-ui, sans-serif';
    const lines = [
      'Candidate Name:   ADEBAYO OLUWASEUN DAVID',
      'Registration No:  KC-2026-849201-NG',
      'Classification:   First Class Honours (CGPA 4.78 / 5.00)',
      'Verification:     Signed & Stamped for Portal Submission',
    ];
    lines.forEach((line, idx) => {
      ctx.fillText(line, 110, 315 + idx * 72);
    });

    // Royal blue signature stroke
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(120, 710);
    ctx.quadraticCurveTo(210, 645, 290, 715);
    ctx.quadraticCurveTo(345, 748, 415, 685);
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Authorized Registrar Signature', 120, 760);

    // Red circular stamp
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(920, 685, 86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#991b1b';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VERIFIED', 920, 692);

    // Realistic uneven diagonal phone-camera shadow across the left half
    const shadow = ctx.createLinearGradient(0, 0, 1080, 620);
    shadow.addColorStop(0, 'rgba(15, 23, 42, 0.56)');
    shadow.addColorStop(0.55, 'rgba(15, 23, 42, 0.22)');
    shadow.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(0, 0, 1200, 900);

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Sample doc encode failed'))),
        'image/jpeg',
        0.88,
      ),
    );
    return new File([blob], 'shadowed-certificate-scan.jpg', { type: 'image/jpeg' });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function App() {
  const { route, navigate } = useRoute();
  const basePresets = useMemo(() => buildPresetCatalog(BUNDLED_SPECS), []);
  const [savedPresets, setSavedPresets] = useState<SizePreset[]>(() => loadSavedPresets());
  const presets = useMemo(() => [...savedPresets, ...basePresets], [savedPresets, basePresets]);
  const initialState = useMemo(() => resolveInitialState(basePresets), [basePresets]);

  const clientRef = useRef<EngineClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const dragDepthRef = useRef(0);
  const sourceSeqRef = useRef(0);

  const [engineMode, setEngineMode] = useState<'worker' | 'main-thread'>('worker');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [sharedRuleTitle, setSharedRuleTitle] = useState<string | null>(
    initialState.sharedRuleTitle,
  );

  // Controls state
  const [activePresetId, setActivePresetId] = useState(initialState.activePresetId);
  const [widthStr, setWidthStr] = useState(initialState.widthStr);
  const [heightStr, setHeightStr] = useState(initialState.heightStr);
  const [fit, setFit] = useState<FitMode>(initialState.fit);
  const [backdrop, setBackdrop] = useState<PadBackdropStyle>('blur');
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [format, setFormat] = useState<OutputFormat>(initialState.format);
  const [minKb, setMinKb] = useState<number | null>(initialState.minKb);
  const [maxKbStr, setMaxKbStr] = useState(initialState.maxKbStr);
  const [dpi, setDpi] = useState<number | null>(initialState.dpi);
  const [quality, setQuality] = useState(82);
  const [autoContrast, setAutoContrast] = useState(true);
  const [sharpenPct, setSharpenPct] = useState(35);
  const [focalMode, setFocalMode] = useState<'auto' | 'manual'>('auto');
  const [focalX, setFocalX] = useState(0);
  const [focalY, setFocalY] = useState(0);

  // Placement Simulator & copy feedback
  const [simEnabled, setSimEnabled] = useState(false);
  const [simMode, setSimMode] = useState<SimulatorMode>(() =>
    defaultSimulatorForPreset(initialState.activePresetId),
  );
  const [copiedImageFeedback, setCopiedImageFeedback] = useState(false);
  const [copiedLinkFeedback, setCopiedLinkFeedback] = useState(false);

  // Active photo + render state
  const [sourceState, setSourceState] = useState<{
    key: string;
    file: File;
    report: InspectReport;
    origUrl: string;
    blockedReason: string | null;
  } | null>(null);
  const [renderOut, setRenderOut] = useState<{
    result: ResizeCompressResult;
    stats: ResizeCompressStats;
    url: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparingOriginal, setComparingOriginal] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [launchBatchFiles, setLaunchBatchFiles] = useState<File[]>([]);

  const clipboardSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    const client = createEngineClient();
    clientRef.current = client;
    setEngineMode(client.mode);
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      activeAbortRef.current?.abort();
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sourceState?.origUrl) {
        URL.revokeObjectURL(sourceState.origUrl);
      }
    };
  }, [sourceState]);

  useEffect(() => {
    return () => {
      if (renderOut?.url) {
        URL.revokeObjectURL(renderOut.url);
      }
    };
  }, [renderOut]);

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  );

  const parsedTargetWidth = useMemo(() => {
    const n = parseOptionalPositiveInt(widthStr);
    return n ? Math.min(8000, n) : null;
  }, [widthStr]);

  const parsedTargetHeight = useMemo(() => {
    const n = parseOptionalPositiveInt(heightStr);
    return n ? Math.min(8000, n) : null;
  }, [heightStr]);

  const parsedMaxKb = useMemo(() => parseOptionalPositiveInt(maxKbStr), [maxKbStr]);

  const executeRender = useCallback(
    async (
      src: { key: string; file: File; report: InspectReport; blockedReason: string | null },
      opts: ResizeCompressOptions,
    ) => {
      if (src.blockedReason) return;
      const client = clientRef.current;
      if (!client) return;

      activeAbortRef.current?.abort();
      const controller = new AbortController();
      activeAbortRef.current = controller;
      const myRunId = ++runIdRef.current;

      setBusy(true);
      setError(null);

      try {
        const { result, stats } = await client.resizeCompress(
          src.key,
          src.file,
          opts,
          src.report,
          controller.signal,
        );
        if (controller.signal.aborted || myRunId !== runIdRef.current) {
          return;
        }
        const url = URL.createObjectURL(result.blob);
        setRenderOut({ result, stats, url });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (myRunId !== runIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (myRunId === runIdRef.current) {
          setBusy(false);
        }
      }
    },
    [],
  );

  const currentOptions: ResizeCompressOptions = useMemo(
    () => ({
      targetWidth: parsedTargetWidth,
      targetHeight: parsedTargetHeight,
      fit,
      backdrop,
      dontEnlarge,
      focalX,
      focalY,
      autoFocus: focalMode === 'auto',
      format,
      quality: quality / 100,
      minKb,
      maxKb: parsedMaxKb,
      dpi,
      autoContrast,
      sharpenPct,
      allowShrinkToFitKb: true,
      assessQuality: true,
    }),
    [
      parsedTargetWidth,
      parsedTargetHeight,
      fit,
      backdrop,
      dontEnlarge,
      focalX,
      focalY,
      focalMode,
      format,
      quality,
      minKb,
      parsedMaxKb,
      dpi,
      autoContrast,
      sharpenPct,
    ],
  );

  const lastImmediateKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sourceState || sourceState.blockedReason || route !== '/') return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (lastImmediateKeyRef.current !== sourceState.key) {
      lastImmediateKeyRef.current = sourceState.key;
      void executeRender(sourceState, currentOptions);
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void executeRender(sourceState, currentOptions);
    }, 120);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [sourceState, currentOptions, executeRender, route]);

  const loadFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !clientRef.current) return;
      if (
        file.type &&
        !file.type.startsWith('image/') &&
        !/\.(jpe?g|png|webp|heic|heif|bmp|gif|avif)$/i.test(file.name)
      ) {
        setError('That file couldn’t be read as an image. Try a JPG, PNG or WebP.');
        return;
      }
      if (file.size > MAX_INPUT_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        setError(`That file is ${mb} MB, above the 50 MB offline safety limit.`);
        return;
      }

      setError(null);
      setComparingOriginal(false);

      try {
        const report = await clientRef.current.inspect(file, file.name);
        const blocking = report.issues.find((i) => i.severity === 'blocking');
        const blockedReason = blocking ? `${blocking.title}: ${blocking.detail}` : null;
        if (blockedReason) {
          setError(blockedReason);
          if (route !== '/inspect' && route !== '/compare' && route !== '/documents') {
            return;
          }
        }

        const key = `${++sourceSeqRef.current}-${file.name}-${file.size}`;
        const origUrl = URL.createObjectURL(file);
        clientRef.current.clearSource();
        setFocalMode('auto');
        setFocalX(0);
        setFocalY(0);

        if (
          !blockedReason &&
          file.type === 'image/png' &&
          maxKbStr.trim() === '' &&
          activePresetId === 'custom'
        ) {
          setFormat('webp');
        }

        setRenderOut(null);
        setSourceState({ key, file, report, origUrl, blockedReason });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'That file couldn’t be read as an image. Try a JPG, PNG or WebP.',
        );
      }
    },
    [activePresetId, maxKbStr, route],
  );

  async function handleLoadSample() {
    try {
      const sampleFile = await createSampleStudioFile();
      await loadFile(sampleFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLoadSampleDocument() {
    try {
      const sampleDoc = await createSampleDocumentFile();
      await loadFile(sampleDoc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const handleProcessBatchFile = useCallback(
    async (
      file: File,
      options: ResizeCompressOptions,
      signal?: AbortSignal,
    ): Promise<ResizeCompressResult> => {
      const client = clientRef.current;
      if (!client) throw new Error('Engine is not initialized.');
      if (file.size > MAX_INPUT_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`${file.name} (${mb} MB) exceeds the 50 MB offline limit.`);
      }
      const report = await client.inspect(file, file.name, signal);
      const blocking = report.issues.find((i) => i.severity === 'blocking');
      if (blocking) {
        throw new Error(`${blocking.title}: ${blocking.detail}`);
      }
      const batchKey = `batch-${++sourceSeqRef.current}-${file.name}-${file.size}`;
      try {
        const { result } = await client.resizeCompress(batchKey, file, options, report, signal);
        return result;
      } finally {
        client.clearSource();
      }
    },
    [],
  );

  const handleCompareFormat = useCallback(
    async (options: ResizeCompressOptions, signal?: AbortSignal): Promise<ResizeCompressResult> => {
      const client = clientRef.current;
      if (!client || !sourceState) {
        throw new Error('No source image loaded.');
      }
      const { result } = await client.resizeCompress(
        sourceState.key,
        sourceState.file,
        options,
        sourceState.report,
        signal,
      );
      return result;
    },
    [sourceState],
  );

  const handleRunDocumentClean = useCallback(
    async (options: DocumentCleanOptions, signal?: AbortSignal): Promise<DocumentCleanResult> => {
      const client = clientRef.current;
      if (!client || !sourceState) {
        throw new Error('No document image loaded.');
      }
      return client.documentClean(
        sourceState.key,
        sourceState.file,
        options,
        sourceState.report,
        signal,
      );
    },
    [sourceState],
  );

  const handleRunWebKit = useCallback(
    async (options: WebKitOptions, signal?: AbortSignal): Promise<WebKitResult> => {
      const client = clientRef.current;
      if (!client || !sourceState) {
        throw new Error('No source image loaded.');
      }
      return client.webKitExport(
        sourceState.key,
        sourceState.file,
        options,
        sourceState.report,
        signal,
      );
    },
    [sourceState],
  );

  const loadFileRef = useRef(loadFile);
  loadFileRef.current = loadFile;

  useEffect(() => {
    const unsub = subscribeLaunchFiles((files) => {
      if (files.length > 1) {
        setLaunchBatchFiles(files);
        navigate('/batch');
      } else if (files[0]) {
        void loadFileRef.current(files[0]);
      }
    });
    void consumeSharedTargetFile().then((shared) => {
      if (shared) {
        void loadFileRef.current(shared);
      }
    });
    return unsub;
  }, [navigate]);

  useEffect(() => {
    if (route === '/print' || route === '/batch' || route === '/presets') return;
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragDepthRef.current++;
      setIsOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsOver(false);
      const dropped = e.dataTransfer?.files?.[0];
      if (dropped) void loadFile(dropped);
    };
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const pasted = item.getAsFile();
          if (pasted) void loadFile(pasted);
          break;
        }
      }
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, [loadFile, route]);

  function handleSelectPreset(presetId: string) {
    const p = presets.find((item) => item.id === presetId);
    if (!p) return;
    setActivePresetId(p.id);
    setWidthStr(p.width ? String(p.width) : '');
    setHeightStr(p.height ? String(p.height) : '');
    setFit(p.fit);
    if (p.backdrop) setBackdrop(p.backdrop);
    setFocalMode('auto');
    setFocalX(0);
    setFocalY(0);
    setMinKb(p.minKb ?? null);
    setMaxKbStr(p.maxKb ? String(p.maxKb) : '');
    setDpi(p.dpi ?? null);
    if (p.format) setFormat(p.format);
    if (typeof p.autoContrast === 'boolean') setAutoContrast(p.autoContrast);
    if (typeof p.sharpenPct === 'number') setSharpenPct(p.sharpenPct);
    const defaultSim = defaultSimulatorForPreset(p.id);
    if (defaultSim !== 'none') {
      setSimMode(defaultSim);
    }
    setSharedRuleTitle(null);
  }

  function handleSavePreset(name: string) {
    const { list, created } = saveCustomPreset({
      label: name,
      width: parsedTargetWidth,
      height: parsedTargetHeight,
      fit,
      backdrop,
      format,
      maxKb: parsedMaxKb,
      autoContrast,
      sharpenPct,
    });
    setSavedPresets(list);
    setActivePresetId(created.id);
  }

  function handleDeletePreset(id: string) {
    const next = deleteCustomPreset(id);
    setSavedPresets(next);
    handleSelectPreset('custom');
  }

  async function handleCopyRecipeLink() {
    const query = buildRecipeQuery({
      title: activePreset?.label ?? 'Custom Size',
      width: parsedTargetWidth,
      height: parsedTargetHeight,
      fit,
      format,
      minKb,
      maxKb: parsedMaxKb,
      dpi,
    });
    const url = `${window.location.origin}${appHref('/')}${query}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.history.replaceState(null, '', `${appHref('/')}${query}`);
    }
    setCopiedLinkFeedback(true);
    window.setTimeout(() => setCopiedLinkFeedback(false), 1800);
  }

  function handleApplyPastedRule(rawText: string): string | null {
    const parsed = parsePortalRule(rawText);
    if (parsed.matchedFields.length === 0) {
      return 'No size, pixel, or KB limits recognized. Try e.g. "600x600px, max 25KB".';
    }
    const resolved = resolveOutputDimensions(parsed.spec);
    setActivePresetId('custom');
    setWidthStr(String(resolved.width));
    setHeightStr(String(resolved.height));
    setFit('fill');
    setFocalMode('auto');
    setFocalX(0);
    setFocalY(0);
    setFormat(parsed.spec.output.format);
    setMinKb(parsed.spec.output.fileSizeKb.min);
    setMaxKbStr(parsed.spec.output.fileSizeKb.max ? String(parsed.spec.output.fileSizeKb.max) : '');
    setDpi(resolved.dpi);
    setSharedRuleTitle(null);
    return parsed.warnings[0] ?? null;
  }

  function handleDownload() {
    if (!renderOut) return;
    const baseName = sourceState?.file.name ?? 'image';
    const filename = formatOutputFilename(
      baseName,
      renderOut.result.width,
      renderOut.result.height,
      renderOut.result.actualFormat,
    );
    const a = document.createElement('a');
    a.href = renderOut.url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleCopyImage() {
    if (!renderOut || !clipboardSupported) return;
    try {
      const pngBlob = await blobToPngBlob(renderOut.result.blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      setCopiedImageFeedback(true);
      window.setTimeout(() => setCopiedImageFeedback(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clipboard image copy was blocked.');
    }
  }

  async function handleCleanInspectDownload() {
    if (!sourceState || !clientRef.current) return;
    if (sourceState.blockedReason) {
      throw new Error(sourceState.blockedReason);
    }
    const cleanFormat: OutputFormat = sourceState.report.container === 'png' ? 'png' : 'jpeg';
    const { result } = await clientRef.current.resizeCompress(
      sourceState.key,
      sourceState.file,
      {
        targetWidth: null,
        targetHeight: null,
        fit: 'inside',
        dontEnlarge: true,
        format: cleanFormat,
        quality: 0.94,
        minKb: null,
        maxKb: null,
        dpi: null,
        autoContrast: false,
        sharpenPct: 0,
        assessQuality: false,
      },
      sourceState.report,
    );
    const url = URL.createObjectURL(result.blob);
    try {
      const cleanName = sourceState.file.name.replace(/\.[^.]+$/, '') || 'image';
      const ext = cleanFormat === 'png' ? 'png' : 'jpg';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanName}-clean.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleRenderSheet(
    layout: PrintSheetLayout,
    inputs: PrintSheetInput[],
    options: { mode: 'single' | 'multi'; copies?: number; cutMarks?: boolean },
  ): Promise<PrintSheetResult> {
    if (!clientRef.current) {
      throw new Error('Engine is not initialized.');
    }
    return clientRef.current.printSheet(layout, inputs, options);
  }

  function cycleTheme() {
    setTheme((prev) => {
      if (prev === 'system') {
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        return prefersDark ? 'light' : 'dark';
      }
      return prev === 'dark' ? 'light' : 'dark';
    });
  }

  const isDarkUi =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <div class="page-shell">
      <header class="studio-topbar">
        <div class="topbar-inner">
          <a
            href={appHref('/')}
            class="brand-row brand-link"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <svg class="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <rect width="64" height="64" rx="14" fill="#111827" />
              <path
                d="M16 25V16H25M48 25V16H39M16 39V48H25M48 39V48H39"
                stroke="#3B82F6"
                stroke-width="4.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <rect
                x="23"
                y="23"
                width="18"
                height="18"
                rx="4"
                stroke="#FFFFFF"
                stroke-width="3.5"
              />
              <circle cx="32" cy="32" r="3" fill="#3B82F6" />
            </svg>
            <h1>KiloCrop</h1>
            <span class="trust-badge">
              <span class="trust-dot" aria-hidden="true" />0 B · Offline
            </span>
          </a>

          <nav class="site-nav" aria-label="Studio tools">
            <a
              href={appHref('/')}
              class={route === '/' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/');
              }}
            >
              <ResizeIcon />
              <span>Resize</span>
            </a>
            <a
              href={appHref('/batch')}
              class={route === '/batch' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/batch' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/batch');
              }}
            >
              <LayersIcon />
              <span>Batch</span>
            </a>
            <a
              href={appHref('/compare')}
              class={route === '/compare' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/compare' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/compare');
              }}
            >
              <SplitCompareIcon />
              <span>Compare</span>
            </a>
            <a
              href={appHref('/documents')}
              class={route === '/documents' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/documents' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/documents');
              }}
            >
              <DocumentIcon />
              <span>Documents</span>
            </a>
            <a
              href={appHref('/inspect')}
              class={route === '/inspect' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/inspect' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/inspect');
              }}
            >
              <XRayIcon />
              <span>X-Ray</span>
            </a>
            <a
              href={appHref('/print')}
              class={route === '/print' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/print' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/print');
              }}
            >
              <PrinterIcon />
              <span>Print Sheet</span>
            </a>
            <a
              href={appHref('/presets')}
              class={route === '/presets' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/presets' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/presets');
              }}
            >
              <GridIcon />
              <span>Presets</span>
            </a>
            <a
              href={appHref('/web-kit')}
              class={route === '/web-kit' ? 'nav-link active' : 'nav-link'}
              aria-current={route === '/web-kit' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/web-kit');
              }}
            >
              <CodeIcon />
              <span>Web Kit</span>
            </a>
            <a href={appHref('/guides/')} class="nav-link">
              <BookIcon />
              <span>Guides</span>
            </a>
          </nav>

          <button
            type="button"
            class="theme-toggle"
            aria-pressed={isDarkUi}
            onClick={cycleTheme}
            title="Switch light or dark theme"
          >
            {isDarkUi ? <SunIcon /> : <MoonIcon />}
            <span>{isDarkUi ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {sharedRuleTitle && route === '/' && (
        <div class="shared-banner" role="status">
          <span>
            Shared custom rule: <strong>{sharedRuleTitle}</strong> ({widthStr || 'auto'}×
            {heightStr || 'auto'} px{maxKbStr ? `, ≤ ${maxKbStr} KB` : ''})
          </span>
          <button type="button" class="btn-link" onClick={() => handleSelectPreset('custom')}>
            Reset
          </button>
        </div>
      )}

      {route === '/' && (
        <main class="studio-main">
          <StageView
            hasFile={Boolean(sourceState && !sourceState.blockedReason)}
            isOver={isOver}
            busy={busy}
            comparingOriginal={comparingOriginal}
            originalUrl={sourceState?.origUrl ?? null}
            resultUrl={renderOut?.url ?? null}
            result={renderOut?.result ?? null}
            origFileBytes={sourceState?.file.size ?? 0}
            activePresetId={activePresetId}
            fit={fit}
            focalMode={focalMode}
            focalX={focalX}
            focalY={focalY}
            error={error}
            activeMaxKb={parsedMaxKb}
            requestedFormat={format}
            activePresetNote={activePreset?.note ?? null}
            simEnabled={simEnabled}
            simMode={simMode}
            onChooseFile={() => fileInputRef.current?.click()}
            onLoadSample={() => void handleLoadSample()}
            onSelectPreset={handleSelectPreset}
            onFocalChange={(fx, fy) => {
              setFocalMode('manual');
              setFocalX(fx);
              setFocalY(fy);
            }}
            onResetAutoFocal={() => {
              setFocalMode('auto');
              setFocalX(0);
              setFocalY(0);
            }}
            onToggleSim={() =>
              setSimEnabled((prev) => {
                const next = !prev;
                if (next && simMode === 'none') {
                  const presetSim = defaultSimulatorForPreset(activePresetId);
                  setSimMode(presetSim === 'none' ? 'og-card' : presetSim);
                }
                return next;
              })
            }
            onSimModeChange={setSimMode}
            onSwitchToWebp={() => setFormat('webp')}
          />

          <ControlPanel
            presets={presets}
            activePresetId={activePresetId}
            widthStr={widthStr}
            heightStr={heightStr}
            fit={fit}
            backdrop={backdrop}
            dontEnlarge={dontEnlarge}
            format={format}
            maxKbStr={maxKbStr}
            quality={quality}
            autoContrast={autoContrast}
            sharpenPct={sharpenPct}
            hasFile={Boolean(sourceState && !sourceState.blockedReason)}
            canDownload={Boolean(renderOut) && !busy}
            canCompare={Boolean(renderOut && sourceState?.origUrl)}
            resultMeta={
              renderOut
                ? {
                    bytes: renderOut.result.bytes,
                    actualFormat: renderOut.result.actualFormat,
                  }
                : null
            }
            clipboardSupported={clipboardSupported}
            copiedImageFeedback={copiedImageFeedback}
            copiedLinkFeedback={copiedLinkFeedback}
            onSelectPreset={handleSelectPreset}
            onSavePreset={handleSavePreset}
            onDeletePreset={handleDeletePreset}
            onCopyRecipeLink={() => void handleCopyRecipeLink()}
            onApplyPastedRule={handleApplyPastedRule}
            onWidthChange={(val) => {
              setActivePresetId('custom');
              setMinKb(null);
              setDpi(null);
              setWidthStr(val);
            }}
            onHeightChange={(val) => {
              setActivePresetId('custom');
              setMinKb(null);
              setDpi(null);
              setHeightStr(val);
            }}
            onFitChange={(nextFit) => {
              setFit(nextFit);
              setFocalMode('auto');
              setFocalX(0);
              setFocalY(0);
            }}
            onBackdropChange={setBackdrop}
            onDontEnlargeChange={setDontEnlarge}
            onFormatChange={setFormat}
            onMaxKbChange={(val) => {
              setMaxKbStr(val);
              if (val.trim() === '') {
                setMinKb(null);
              }
            }}
            onQualityChange={setQuality}
            onAutoContrastChange={setAutoContrast}
            onSharpenChange={setSharpenPct}
            onDownload={handleDownload}
            onCopyImage={() => void handleCopyImage()}
            onCompareHold={setComparingOriginal}
            onChooseAnother={() => fileInputRef.current?.click()}
          />
        </main>
      )}

      {route === '/inspect' && (
        <main class="sheet-main">
          <LazyInspectPage
            file={sourceState?.file ?? null}
            report={sourceState?.report ?? null}
            origUrl={sourceState?.origUrl ?? null}
            blockingError={sourceState?.blockedReason ?? error}
            isOver={isOver}
            onChooseFile={() => fileInputRef.current?.click()}
            onOpenInResizer={() => navigate('/')}
            onCleanDownload={handleCleanInspectDownload}
          />
        </main>
      )}

      {route === '/print' && (
        <main class="sheet-main">
          <LazyPrintSheetView
            initialPhoto={
              renderOut
                ? {
                    blob: renderOut.result.blob,
                    url: renderOut.url,
                    label: activePreset?.label ?? '',
                  }
                : null
            }
            onRenderSheet={handleRenderSheet}
            onBack={() => navigate('/')}
          />
        </main>
      )}

      {route === '/batch' && (
        <LazyBatchPage
          presets={presets}
          initialFiles={launchBatchFiles}
          onConsumedInitialFiles={() => setLaunchBatchFiles([])}
          onProcessFile={handleProcessBatchFile}
          onError={(msg) => setError(msg)}
        />
      )}

      {route === '/compare' && (
        <main class="sheet-main">
          <LazyComparePage
            sourceState={sourceState}
            isOver={isOver}
            onChooseFile={() => fileInputRef.current?.click()}
            onLoadSample={() => void handleLoadSample()}
            onRunFormat={handleCompareFormat}
            onUseInResizer={(settings) => {
              setActivePresetId('custom');
              setFormat(settings.format);
              setQuality(settings.quality);
              setMaxKbStr(settings.maxKbStr);
              setAutoContrast(settings.autoContrast);
              setSharpenPct(settings.sharpenPct);
              setWidthStr(settings.widthStr);
              setHeightStr('');
              setFit('inside');
              navigate('/');
            }}
          />
        </main>
      )}

      {route === '/documents' && (
        <LazyDocumentsPage
          sourceState={sourceState}
          isOver={isOver}
          onChooseFile={() => fileInputRef.current?.click()}
          onLoadSampleDocument={() => void handleLoadSampleDocument()}
          onRunDocumentClean={handleRunDocumentClean}
        />
      )}

      {route === '/presets' && (
        <main class="sheet-main">
          <LazyPresetsPage
            presets={presets}
            specs={BUNDLED_SPECS}
            onPickPreset={(id) => {
              handleSelectPreset(id);
              navigate('/');
            }}
            onOpenPrintSheet={() => navigate('/print')}
            onDeleteSavedPreset={handleDeletePreset}
            onApplyPastedRule={(rawText) => {
              const parsed = parsePortalRule(rawText);
              if (parsed.matchedFields.length === 0) {
                return 'No size, pixel, or KB limits recognized. Try e.g. "600x600px, max 25KB".';
              }
              handleApplyPastedRule(rawText);
              navigate('/');
              return null;
            }}
          />
        </main>
      )}

      {route === '/web-kit' && (
        <LazyWebKitPage
          sourceState={sourceState}
          isOver={isOver}
          onChooseFile={() => fileInputRef.current?.click()}
          onLoadSample={() => void handleLoadSample()}
          onRunWebKit={handleRunWebKit}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        id="file"
        accept="image/*"
        class="sr-only"
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const picked = input.files?.[0];
          if (picked) void loadFile(picked);
          input.value = '';
        }}
      />

      <PipelineStatsDrawer stats={renderOut?.stats ?? null} engineMode={engineMode} />
    </div>
  );
}
