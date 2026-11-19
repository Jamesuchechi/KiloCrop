import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  PHOTO_PRINT_PRESETS,
  SHEET_PRESETS,
  computePrintSheetLayout,
  type PrintSheetInput,
} from '../engine/print-sheet';
import type { PrintSheetLayout, PrintSheetPresetId, PrintSheetResult } from '../engine/types';

export interface PrintSheetViewProps {
  initialPhoto: { blob: Blob; url: string; label: string } | null;
  onRenderSheet: (
    layout: PrintSheetLayout,
    inputs: PrintSheetInput[],
    options: { mode: 'single' | 'multi'; copies?: number; cutMarks?: boolean },
  ) => Promise<PrintSheetResult>;
  onBack: () => void;
}

interface MultiSlotItem {
  id: number;
  file: Blob;
  url: string;
  label: string;
}

export function PrintSheetView(props: PrintSheetViewProps) {
  const { initialPhoto, onRenderSheet, onBack } = props;

  const [sheetId, setSheetId] = useState<PrintSheetPresetId>('4x6');
  const [photoPresetId, setPhotoPresetId] = useState('35x45');
  const [mode, setMode] = useState<'single' | 'multi'>(initialPhoto ? 'single' : 'multi');
  const [copies, setCopies] = useState(8);
  const [cutMarks, setCutMarks] = useState(true);
  const [multiItems, setMultiItems] = useState<MultiSlotItem[]>(() =>
    initialPhoto ? [{ id: 1, file: initialPhoto.blob, url: initialPhoto.url, label: '' }] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetResult, setSheetResult] = useState<{ res: PrintSheetResult; url: string } | null>(
    null,
  );

  const nextIdRef = useMemo(() => ({ val: 2 }), []);

  const photoPreset = useMemo(
    () => PHOTO_PRINT_PRESETS.find((p) => p.id === photoPresetId) ?? PHOTO_PRINT_PRESETS[0]!,
    [photoPresetId],
  );

  const layout = useMemo(
    () =>
      computePrintSheetLayout({
        sheetId,
        photoWidthMm: photoPreset.widthMm,
        photoHeightMm: photoPreset.heightMm,
        dpi: 300,
      }),
    [photoPreset, sheetId],
  );

  useEffect(() => {
    setCopies((c) => Math.max(1, Math.min(c, layout.capacity || 1)));
  }, [layout.capacity]);

  useEffect(() => {
    return () => {
      if (sheetResult?.url) URL.revokeObjectURL(sheetResult.url);
    };
  }, [sheetResult]);

  const multiItemsRef = useRef<MultiSlotItem[]>(multiItems);
  multiItemsRef.current = multiItems;

  useEffect(() => {
    return () => {
      for (const item of multiItemsRef.current) {
        if (!initialPhoto || item.url !== initialPhoto.url) {
          URL.revokeObjectURL(item.url);
        }
      }
    };
  }, [initialPhoto]);

  function addMultiFiles(files: FileList | null) {
    if (!files) return;
    const slotsLeft = Math.max(0, layout.capacity - multiItems.length);
    const additions: MultiSlotItem[] = [];
    for (let i = 0; i < Math.min(files.length, slotsLeft); i++) {
      const f = files[i]!;
      additions.push({
        id: nextIdRef.val++,
        file: f,
        url: URL.createObjectURL(f),
        label: '',
      });
    }
    if (additions.length > 0) {
      setMultiItems((prev) => [...prev, ...additions]);
    }
  }

  function removeMultiItem(id: number) {
    setMultiItems((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target && (!initialPhoto || target.url !== initialPhoto.url)) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const inputs: PrintSheetInput[] =
        mode === 'single'
          ? initialPhoto
            ? [{ blob: initialPhoto.blob }]
            : []
          : multiItems.map((m) => ({ blob: m.file, label: m.label }));

      if (inputs.length === 0) {
        setError('Add at least one photo first.');
        return;
      }

      const res = await onRenderSheet(layout, inputs, { mode, copies, cutMarks });
      const url = URL.createObjectURL(res.blob);
      setSheetResult((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { res, url };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sheetFilename = `KiloCrop-${sheetId}-${layout.capacity}up-300dpi.png`;

  return (
    <section class="card stack">
      <div class="row-between">
        <div>
          <strong>Print Sheet Packer (300 DPI PNG)</strong>
          <div class="muted">
            Fits up to <strong>{layout.capacity}</strong> photos ({layout.cols}×{layout.rows}
            {layout.rotated ? ', auto-rotated 90°' : ''})
          </div>
        </div>
        <button type="button" class="btn-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          class={mode === 'single' ? 'tab active' : 'tab'}
          onClick={() => setMode('single')}
          disabled={!initialPhoto}
        >
          Single person ({layout.capacity}×)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'multi'}
          class={mode === 'multi' ? 'tab active' : 'tab'}
          onClick={() => setMode('multi')}
        >
          Multi-photo (Café / Family)
        </button>
      </div>

      <div class="custom-grid">
        <label class="mini-field">
          <span>Paper size</span>
          <select
            class="input"
            value={sheetId}
            onChange={(e) =>
              setSheetId((e.target as HTMLSelectElement).value as PrintSheetPresetId)
            }
          >
            {Object.values(SHEET_PRESETS).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label class="mini-field">
          <span>Print cut size</span>
          <select
            class="input"
            value={photoPresetId}
            onChange={(e) => setPhotoPresetId((e.target as HTMLSelectElement).value)}
          >
            {PHOTO_PRINT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {mode === 'single' ? (
          <label class="mini-field">
            <span>Copies (1–{layout.capacity})</span>
            <input
              type="number"
              class="input"
              min={1}
              max={layout.capacity}
              value={copies}
              onInput={(e) => setCopies(Number((e.target as HTMLInputElement).value) || 1)}
            />
          </label>
        ) : (
          <div class="mini-field">
            <span>Slots filled</span>
            <div class="input input-static">
              {multiItems.length} / {layout.capacity}
            </div>
          </div>
        )}
      </div>

      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={cutMarks}
          onChange={(e) => setCutMarks((e.target as HTMLInputElement).checked)}
        />
        <span>Draw corner cut marks</span>
      </label>

      {mode === 'multi' && (
        <div class="stack-sm">
          <div class="multi-grid">
            {multiItems.map((item, idx) => (
              <div key={item.id} class="multi-slot">
                <img src={item.url} alt={`Slot ${idx + 1}`} />
                <input
                  type="text"
                  class="input"
                  maxLength={14}
                  placeholder={`Name/Initial #${idx + 1}`}
                  value={item.label}
                  onInput={(e) => {
                    const val = (e.target as HTMLInputElement).value;
                    setMultiItems((prev) =>
                      prev.map((p) => (p.id === item.id ? { ...p, label: val } : p)),
                    );
                  }}
                />
                <button
                  type="button"
                  class="btn-link"
                  aria-label={`Remove slot ${idx + 1}`}
                  onClick={() => removeMultiItem(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {multiItems.length < layout.capacity && (
            <label class="btn btn-sec file-btn">
              + Add customer / family photos ({layout.capacity - multiItems.length} slots left)
              <input
                type="file"
                accept="image/*"
                multiple
                class="sr-only"
                onChange={(e) => addMultiFiles((e.target as HTMLInputElement).files)}
              />
            </label>
          )}
        </div>
      )}

      {error && (
        <div class="banner banner-err" role="alert">
          {error}
        </div>
      )}

      <button type="button" class="btn btn-primary" disabled={busy} onClick={handleGenerate}>
        {busy ? 'Packing 300 DPI sheet…' : `Generate ${sheetId.toUpperCase()} Print Sheet`}
      </button>

      {sheetResult && (
        <div class="stack-sm">
          <img
            src={sheetResult.url}
            alt="Generated 300 DPI print sheet"
            class="sheet-preview-img"
          />
          <div class="muted">
            {sheetResult.res.width}×{sheetResult.res.height} px (300 DPI PNG) ·{' '}
            {(sheetResult.res.bytes / 1024).toFixed(0)} KB · {sheetResult.res.count} photos
          </div>
          <a href={sheetResult.url} download={sheetFilename} class="btn btn-primary">
            Save print sheet PNG
          </a>
        </div>
      )}
    </section>
  );
}
