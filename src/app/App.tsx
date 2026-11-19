import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import bundleData from '../../specs/bundle.json';
import { closeBitmap } from '../engine/decode';
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
import type { PrintSheetInput } from '../engine/print-sheet';
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

  return (
    <div class="app-shell">
      <header class="topbar">
        <div>
          <h1 class="brand">KiloCrop</h1>
          <p class="tagline">Fit portal KB &amp; pixel rules offline — never leaves your phone.</p>
        </div>
        {step !== 'pick' && (
          <button type="button" class="btn-link" onClick={resetToPicker}>
            Start over
          </button>
        )}
      </header>

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
          onOpenPrintSheet={() => {
            setReturnStep('pick');
            setStep('sheet');
          }}
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
