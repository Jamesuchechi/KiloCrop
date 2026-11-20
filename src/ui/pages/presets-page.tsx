import { useMemo, useState } from 'preact/hooks';

import { PORTAL_GUIDE_SLUGS, getPresetCategory, type PresetCategory } from '../../engine/presets';
import type { SizePreset, Spec } from '../../engine/types';
import { appHref } from '../base-url';
import {
  BookIcon,
  GridIcon,
  PasteIcon,
  PrinterIcon,
  ResizeIcon,
  SearchIcon,
  TrashIcon,
} from '../icons';

type FilterTab = 'all' | PresetCategory;

const FILTER_TABS: ReadonlyArray<{ id: FilterTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'social', label: 'Social Media' },
  { id: 'web', label: 'Web & Email' },
  { id: 'portal', label: 'Passports & Portals' },
  { id: 'print', label: 'Print Sizes' },
  { id: 'saved', label: 'Saved Custom' },
];

const PRINT_SHEET_CARDS: ReadonlyArray<{
  id: string;
  label: string;
  width: number;
  height: number;
  dpi: number;
  note: string;
}> = [
  {
    id: 'sheet-4x6',
    label: '4×6 in Print Sheet',
    width: 1200,
    height: 1800,
    dpi: 300,
    note: 'Pack up to 8 passport photos (35×45 mm or 2×2 in) on a 4×6 lab print.',
  },
  {
    id: 'sheet-5x7',
    label: '5×7 in Print Sheet',
    width: 1500,
    height: 2100,
    dpi: 300,
    note: 'Multi-photo café / family proof layout at true 300 DPI PNG.',
  },
  {
    id: 'sheet-a4',
    label: 'A4 Print Sheet',
    width: 2480,
    height: 3508,
    dpi: 300,
    note: 'Full A4 studio grid (210×297 mm) with optional cut marks.',
  },
];

export interface PresetsPageProps {
  presets: readonly SizePreset[];
  specs: readonly Spec[];
  onPickPreset: (presetId: string) => void;
  onOpenPrintSheet: () => void;
  onDeleteSavedPreset: (id: string) => void;
  onApplyPastedRule: (rawText: string) => string | null;
}

function getAspectClass(width: number | null, height: number | null): string {
  if (!width || !height) return 'preset-aspect aspect-land';
  const ratio = width / height;
  if (ratio >= 1.8) return 'preset-aspect aspect-wide';
  if (ratio >= 1.15) return 'preset-aspect aspect-land';
  if (ratio >= 0.88) return 'preset-aspect aspect-sq';
  if (ratio >= 0.6) return 'preset-aspect aspect-port';
  return 'preset-aspect aspect-tall';
}

function categoryBadgeLabel(cat: PresetCategory): string {
  if (cat === 'social') return 'Social';
  if (cat === 'web') return 'Web & Email';
  if (cat === 'portal') return 'Portal';
  if (cat === 'print') return 'Print';
  return 'Saved';
}

export function PresetsPage(props: PresetsPageProps) {
  const { presets, specs, onPickPreset, onOpenPrintSheet, onDeleteSavedPreset, onApplyPastedRule } =
    props;

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [ruleInput, setRuleInput] = useState('');
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);

  const specById = useMemo(() => {
    const map = new Map<string, Spec>();
    for (const s of specs) map.set(s.id, s);
    return map;
  }, [specs]);

  const catalogEntries = useMemo(() => {
    const presetItems = presets
      .filter((p) => p.id !== 'custom')
      .map((preset) => {
        const spec = specById.get(preset.id);
        const guideSlug = PORTAL_GUIDE_SLUGS[preset.id] ?? null;
        return {
          kind: 'preset' as const,
          id: preset.id,
          category: getPresetCategory(preset),
          label: preset.label,
          width: preset.width,
          height: preset.height,
          minKb: preset.minKb ?? null,
          maxKb: preset.maxKb ?? null,
          dpi: preset.dpi ?? null,
          format: preset.format ?? 'jpeg',
          backgroundHint: preset.backgroundHint ?? null,
          note: preset.note ?? null,
          region: spec?.region ?? null,
          guideSlug,
        };
      });

    const sheetItems = PRINT_SHEET_CARDS.map((card) => ({
      kind: 'sheet' as const,
      id: card.id,
      category: 'print' as PresetCategory,
      label: card.label,
      width: card.width,
      height: card.height,
      minKb: null,
      maxKb: null,
      dpi: card.dpi,
      format: 'png' as const,
      backgroundHint: null,
      note: card.note,
      region: 'Print Lab',
      guideSlug: null,
    }));

    return [...presetItems, ...sheetItems];
  }, [presets, specById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogEntries.filter((item) => {
      if (tab !== 'all' && item.category !== tab) return false;
      if (!q) return true;
      const haystack = [
        item.label,
        item.id,
        item.region ?? '',
        item.note ?? '',
        item.backgroundHint ?? '',
        item.width ? `${item.width}x${item.height ?? ''}` : '',
        item.maxKb ? `${item.maxKb}kb` : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [catalogEntries, tab, query]);

  function handleApplyRule(e: Event) {
    e.preventDefault();
    if (!ruleInput.trim()) return;
    const msg = onApplyPastedRule(ruleInput);
    if (msg) {
      setRuleMsg(msg);
    } else {
      setRuleMsg(null);
      setRuleInput('');
    }
  }

  return (
    <section class="stack">
      <div class="card presets-hero">
        <div class="row-between">
          <div>
            <h2 class="inspect-heading">
              <GridIcon /> Size &amp; Portal Preset Directory
            </h2>
            <p class="muted m-0">
              Verified social media ratios, responsive web sizes, 300 DPI print sheets, and African
              / international portal rules.
            </p>
          </div>
          <form class="inline-tool-form presets-rule-form" onSubmit={handleApplyRule}>
            <input
              type="text"
              class="input"
              placeholder="Paste portal rule (e.g. 600x600px, max 25KB)…"
              aria-label="Paste portal requirement text"
              value={ruleInput}
              onInput={(e) => setRuleInput((e.target as HTMLInputElement).value)}
            />
            <button type="submit" class="tool-submit">
              <PasteIcon />
              <span>Apply rule</span>
            </button>
          </form>
        </div>
        {ruleMsg && <p class="hint">{ruleMsg}</p>}

        <div class="presets-toolbar">
          <label class="presets-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search presets, dimensions, KB limits, NYSC, UNILORIN…"
              aria-label="Search presets"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </label>

          <div class="presets-tabs" role="tablist" aria-label="Filter presets by category">
            {FILTER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                class={tab === t.id ? 'hero-chip active' : 'hero-chip'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div class="card empty-presets">
          <p class="muted m-0">
            No matching presets found. Try clearing your filter or pasting a custom dimension/KB
            rule above.
          </p>
        </div>
      ) : (
        <div class="preset-dir-grid">
          {filtered.map((item) => (
            <article class="card preset-card" key={item.id}>
              <div class="preset-card-top">
                <div class={getAspectClass(item.width, item.height)} aria-hidden="true">
                  <span>{item.width ?? 'auto'}</span>
                  <span>×{item.height ?? 'auto'}</span>
                </div>
                <div class="preset-card-info">
                  <div class="preset-card-badges">
                    <span class="xray-pill xray-pill-ok">{categoryBadgeLabel(item.category)}</span>
                    {item.region && <span class="preset-region">{item.region}</span>}
                  </div>
                  <h3 class="preset-card-title">{item.label}</h3>
                  <div class="preset-specs-row">
                    <span>
                      {item.width ?? 'auto'}×{item.height ?? 'auto'} px
                    </span>
                    <span>· {item.format.toUpperCase()}</span>
                    {item.minKb && item.maxKb ? (
                      <span>
                        · {item.minKb}–{item.maxKb} KB
                      </span>
                    ) : item.maxKb ? (
                      <span>· ≤ {item.maxKb} KB</span>
                    ) : null}
                    {item.dpi && <span>· {item.dpi} DPI</span>}
                  </div>
                </div>
              </div>

              {(item.note || item.backgroundHint) && (
                <p class="preset-card-note">
                  {item.note ?? `Background required: ${item.backgroundHint}.`}
                </p>
              )}

              <div class="preset-card-actions">
                {item.kind === 'sheet' ? (
                  <button type="button" class="btn btn-primary" onClick={onOpenPrintSheet}>
                    <PrinterIcon />
                    <span>Open Print Sheet →</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    class="btn btn-primary"
                    onClick={() => onPickPreset(item.id)}
                  >
                    <ResizeIcon />
                    <span>Use in Resize →</span>
                  </button>
                )}

                {item.guideSlug && (
                  <a href={appHref(`/guides/${item.guideSlug}/`)} class="btn btn-sec">
                    <BookIcon />
                    <span>Read guide</span>
                  </a>
                )}

                {item.category === 'saved' && (
                  <button
                    type="button"
                    class="tool-chip tool-chip-danger"
                    aria-label={`Delete saved preset ${item.label}`}
                    onClick={() => onDeleteSavedPreset(item.id)}
                  >
                    <TrashIcon />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
