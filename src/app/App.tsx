import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import bundleData from '../../specs/bundle.json';
import { closeBitmap } from '../engine/decode';
import type { PrintSheetInput } from '../engine/print-sheet';
import { parsePortalRule, parseQuerySpec, toQuerySpec } from '../engine/rule-parser';
import { findSpecById } from '../engine/specs';
import type {
  BitmapLike,
  EncodeResult,
  InspectReport,
  PipelineStats,
  PrintSheetLayout,
  PrintSheetResult,
  Rect,
  Spec,
} from '../engine/types';
import { CropEditor } from '../ui/crop-editor/CropEditor';
import { PipelineStatsDrawer } from '../ui/pipeline-stats-drawer';
import { PortalPicker } from '../ui/portal-picker';
import { PrintSheetView } from '../ui/print-sheet-view';
import { ResultView } from '../ui/result-view';
import { createEngineClient } from '../workers/client';
import type { EngineClient } from '../workers/protocol';

const BUNDLED_SPECS = bundleData as Spec[];

type Step = 'pick' | 'crop' | 'result' | 'sheet';

export function App() {
  const clientRef = useRef<EngineClient | null>(null);
  const [engineMode, setEngineMode] = useState<'worker' | 'main-thread'>('worker');

  const initialQuerySpec = useMemo(() => parseQuerySpec(window.location.search), []);
  const initialPreset = useMemo(() => {
    const id = new URLSearchParams(window.location.search).get('spec');
    return findSpecById(BUNDLED_SPECS, id) ?? BUNDLED_SPECS[0]!;
  }, []);

  const [step, setStep] = useState<Step>('pick');
  const [returnStep, setReturnStep] = useState<Step>('pick');
  const [pickerMode, setPickerMode] = useState<'presets' | 'paste'>(
    initialQuerySpec ? 'paste' : 'presets',
  );
  const [sharedQuerySpec, setSharedQuerySpec] = useState<Spec | null>(initialQuerySpec);
  const [ruleText, setRuleText] = useState('Passport must be JPG, max 25KB, 600x600px');
  const [activeSpec, setActiveSpec] = useState<Spec>(initialQuerySpec ?? initialPreset);
  const [parsedSummary, setParsedSummary] = useState<{
    matchedFields: string[];
    confidence: string;
    warnings: string[];
  } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [inspectReport, setInspectReport] = useState<InspectReport | null>(null);
  const [previewBmp, setPreviewBmp] = useState<BitmapLike | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportOut, setExportOut] = useState<{
    result: EncodeResult;
    stats: PipelineStats;
    url: string;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const client = createEngineClient();
    clientRef.current = client;
    setEngineMode(client.mode);
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  // Single-image memory cleanup: close old preview BitmapLike when replaced or unmounted
  useEffect(() => {
    return () => {
      closeBitmap(previewBmp);
    };
  }, [previewBmp]);

  useEffect(() => {
    return () => {
      if (exportOut?.url) URL.revokeObjectURL(exportOut.url);
    };
  }, [exportOut]);

  function handleRuleTextChange(text: string) {
    setRuleText(text);
    setSharedQuerySpec(null);
    const parsed = parsePortalRule(text);
    setActiveSpec(parsed.spec);
    setParsedSummary({
      matchedFields: parsed.matchedFields,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
    });
  }

  async function handlePickFile(picked: File) {
    if (!clientRef.current) return;
    setFile(picked);
    setError(null);
    setBusy(true);
    setExportOut((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPreviewBmp((prev) => {
      closeBitmap(prev);
      return null;
    });

    try {
      const report = await clientRef.current.inspect(picked, picked.name);
      setInspectReport(report);
      setStep('crop');

      const blocking = report.issues.find((i) => i.severity === 'blocking');
      if (blocking) {
        return;
      }

      const bmp = await clientRef.current.preview(picked, report);
      setPreviewBmp(bmp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('crop');
    } finally {
      setBusy(false);
    }
  }

  async function handleFitPhoto(cropRect: Rect) {
    if (!file || !inspectReport || !clientRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const { result, stats } = await clientRef.current.exportPhoto(
        file,
        activeSpec,
        cropRect,
        inspectReport,
      );
      const url = URL.createObjectURL(result.blob);
      setExportOut({ result, stats, url });
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSharePortalLink() {
    const query = toQuerySpec(activeSpec);
    const fullUrl = `${window.location.origin}${window.location.pathname}${query}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      window.history.replaceState(null, '', query);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
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

  function resetToPicker() {
    setPreviewBmp((prev) => {
      closeBitmap(prev);
      return null;
    });
    setExportOut(null);
    setFile(null);
    setInspectReport(null);
    setError(null);
    setStep('pick');
  }

  const inCropFlow = step !== 'sheet';

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-group">
          <svg class="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#0f172a" />
            <path
              d="M18 24v-6h6M46 24v-6h-6M18 40v6h6M46 40v6h-6"
              stroke="#34d399"
              stroke-width="4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle cx="32" cy="27" r="6" fill="#f8fafc" />
            <path d="M22 44c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="#f8fafc" />
          </svg>
          <div>
            <h1 class="brand">KiloCrop</h1>
            <p class="tagline">
              Fit portal KB &amp; pixel rules offline — never leaves your phone.
            </p>
          </div>
        </div>

        <div class="topbar-right">
          <div class="mode-switch" role="navigation" aria-label="Workspace mode">
            <button
              type="button"
              class={inCropFlow ? 'mode-btn active' : 'mode-btn'}
              onClick={() => setStep(exportOut ? 'result' : file ? 'crop' : 'pick')}
            >
              Crop &amp; Fit
            </button>
            <button
              type="button"
              class={step === 'sheet' ? 'mode-btn active' : 'mode-btn'}
              onClick={() => {
                if (step !== 'sheet') setReturnStep(step);
                setStep('sheet');
              }}
            >
              4×6 Print Sheet
            </button>
          </div>

          <span class="trust-pill">
            <span class="trust-dot" aria-hidden="true" />
            Offline · 0 B sent
          </span>
        </div>
      </header>

      {inCropFlow && (
        <div class="stepper" aria-label="Progress">
          <div class={step === 'pick' ? 'step-pill active' : 'step-pill done'}>
            <span class="step-num">1</span>
            <span>Portal &amp; Photo</span>
          </div>
          <div
            class={
              step === 'crop'
                ? 'step-pill active'
                : step === 'result'
                  ? 'step-pill done'
                  : 'step-pill'
            }
          >
            <span class="step-num">2</span>
            <span>Frame &amp; Crop</span>
          </div>
          <div class={step === 'result' ? 'step-pill active' : 'step-pill'}>
            <span class="step-num">3</span>
            <span>Save &amp; Print</span>
          </div>
        </div>
      )}

      {step === 'pick' && (
        <PortalPicker
          specs={BUNDLED_SPECS}
          activeSpec={activeSpec}
          mode={pickerMode}
          querySharedSpec={sharedQuerySpec}
          ruleText={ruleText}
          parsedSummary={parsedSummary}
          onModeChange={(m) => {
            setPickerMode(m);
            if (
              m === 'presets' &&
              (activeSpec.id === 'pasted-rule' || activeSpec.id === 'shared-query')
            ) {
              setActiveSpec(BUNDLED_SPECS[0]!);
            }
          }}
          onSelectSpec={(spec) => {
            setSharedQuerySpec(null);
            setActiveSpec(spec);
          }}
          onClearSharedQuery={() => {
            setSharedQuerySpec(null);
            setPickerMode('presets');
            setActiveSpec(BUNDLED_SPECS[0]!);
          }}
          onRuleTextChange={handleRuleTextChange}
          onUpdateActiveSpec={(spec) => setActiveSpec(spec)}
          onPickFile={handlePickFile}
        />
      )}

      {step === 'crop' && (
        <CropEditor
          bitmap={previewBmp}
          orientedDims={inspectReport?.orientedDimensions ?? null}
          spec={activeSpec}
          inspectReport={inspectReport}
          busy={busy}
          error={error}
          onFitPhoto={handleFitPhoto}
          onChangePhoto={resetToPicker}
        />
      )}

      {step === 'result' && exportOut && inspectReport && (
        <ResultView
          spec={activeSpec}
          result={exportOut.result}
          stats={exportOut.stats}
          report={inspectReport}
          previewUrl={exportOut.url}
          linkCopied={linkCopied}
          onSharePortalLink={handleSharePortalLink}
          onOpenPrintSheet={() => {
            setReturnStep('result');
            setStep('sheet');
          }}
          onRecrop={() => setStep('crop')}
          onNewPhoto={resetToPicker}
        />
      )}

      {step === 'sheet' && (
        <PrintSheetView
          initialPhoto={
            exportOut
              ? {
                  blob: exportOut.result.blob,
                  url: exportOut.url,
                  label: activeSpec.shortLabel ?? '',
                }
              : null
          }
          onRenderSheet={handleRenderSheet}
          onBack={() => setStep(returnStep)}
        />
      )}

      <PipelineStatsDrawer stats={exportOut?.stats ?? null} engineMode={engineMode} />
    </div>
  );
}
