import { closeBitmap, releaseCanvas } from './decode';
import { setPngDpi } from './dpi';
import { canvasToBytes } from './encode';
import { computeCenteredCrop, computePreviewScale, mmToPx } from './geometry';
import { inspectImageBytes } from './inspect';
import type {
  BitmapLike,
  CanvasContextLike,
  CanvasLike,
  EnginePlatform,
  PrintSheetLayout,
  PrintSheetPresetId,
  PrintSheetResult,
  PrintSheetSlot,
} from './types';

export interface SheetPresetInfo {
  id: PrintSheetPresetId;
  label: string;
  widthMm: number;
  heightMm: number;
}

export interface PhotoPrintPresetInfo {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const SHEET_PRESETS: Record<PrintSheetPresetId, SheetPresetInfo> = {
  '4x6': { id: '4x6', label: '4×6 in (101.6×152.4 mm)', widthMm: 101.6, heightMm: 152.4 },
  '5x7': { id: '5x7', label: '5×7 in (127×177.8 mm)', widthMm: 127, heightMm: 177.8 },
  a4: { id: 'a4', label: 'A4 (210×297 mm)', widthMm: 210, heightMm: 297 },
};

export const PHOTO_PRINT_PRESETS: readonly PhotoPrintPresetInfo[] = [
  { id: '35x45', label: '35×45 mm (Nigeria / ICAO)', widthMm: 35, heightMm: 45 },
  { id: '2x2in', label: '2×2 in (50.8×50.8 mm, US)', widthMm: 50.8, heightMm: 50.8 },
  { id: '52x52', label: '52×52 mm (UI Clearance)', widthMm: 52, heightMm: 52 },
];

export interface ComputeLayoutOptions {
  sheetId: PrintSheetPresetId;
  photoWidthMm: number;
  photoHeightMm: number;
  dpi?: number;
  marginMm?: number;
  gutterMm?: number;
}

export interface PrintSheetInput {
  blob: Blob;
  label?: string;
}

export interface RenderPrintSheetOptions {
  mode: 'single' | 'multi';
  copies?: number;
  cutMarks?: boolean;
  signal?: AbortSignal;
}

const PRINT_SLOT_MAX_EDGE = 1000;

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

function fitGrid(usableW: number, usableH: number, tileW: number, tileH: number, gutterPx: number) {
  if (tileW <= 0 || tileH <= 0 || tileW > usableW || tileH > usableH) {
    return { cols: 0, rows: 0, count: 0 };
  }
  const cols = Math.floor((usableW + gutterPx) / (tileW + gutterPx));
  const rows = Math.floor((usableH + gutterPx) / (tileH + gutterPx));
  return { cols, rows, count: cols * rows };
}

/**
 * Compute optimal upright vs 90-degree rotated grid packing on a print sheet.
 * Uses 3 mm margin & 2 mm gutter defaults so 35x45 mm fits 8-up on 4x6 in at 300 DPI.
 */
export function computePrintSheetLayout(options: ComputeLayoutOptions): PrintSheetLayout {
  const { sheetId, photoWidthMm, photoHeightMm, dpi = 300, marginMm = 3, gutterMm = 2 } = options;

  const sheet = SHEET_PRESETS[sheetId];
  const sheetWidthPx = mmToPx(sheet.widthMm, dpi);
  const sheetHeightPx = mmToPx(sheet.heightMm, dpi);
  const marginPx = marginMm > 0 ? mmToPx(marginMm, dpi) : 0;
  const gutterPx = gutterMm > 0 ? mmToPx(gutterMm, dpi) : 0;
  const photoWidthPx = mmToPx(photoWidthMm, dpi);
  const photoHeightPx = mmToPx(photoHeightMm, dpi);

  const usableW = Math.max(0, sheetWidthPx - 2 * marginPx);
  const usableH = Math.max(0, sheetHeightPx - 2 * marginPx);

  const upright = fitGrid(usableW, usableH, photoWidthPx, photoHeightPx, gutterPx);
  const rotatedGrid = fitGrid(usableW, usableH, photoHeightPx, photoWidthPx, gutterPx);

  const rotated = rotatedGrid.count > upright.count;
  const chosen = rotated ? rotatedGrid : upright;
  const tileW = rotated ? photoHeightPx : photoWidthPx;
  const tileH = rotated ? photoWidthPx : photoHeightPx;

  const slots: PrintSheetSlot[] = [];
  if (chosen.count > 0) {
    const gridW = chosen.cols * tileW + (chosen.cols - 1) * gutterPx;
    const gridH = chosen.rows * tileH + (chosen.rows - 1) * gutterPx;
    const originX = marginPx + Math.floor((usableW - gridW) / 2);
    const originY = marginPx + Math.floor((usableH - gridH) / 2);

    for (let r = 0; r < chosen.rows; r++) {
      for (let c = 0; c < chosen.cols; c++) {
        slots.push({
          x: originX + c * (tileW + gutterPx),
          y: originY + r * (tileH + gutterPx),
          width: tileW,
          height: tileH,
          rotated,
          row: r,
          col: c,
        });
      }
    }
  }

  return {
    sheetId,
    sheetWidthPx,
    sheetHeightPx,
    dpi,
    marginPx,
    gutterPx,
    photoWidthPx,
    photoHeightPx,
    cols: chosen.cols,
    rows: chosen.rows,
    capacity: chosen.count,
    rotated,
    slots,
  };
}

function drawCutMarks(ctx: CanvasContextLike, slot: PrintSheetSlot): void {
  const tick = 10;
  const { x, y, width, height } = slot;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(x, y + tick);
  ctx.lineTo(x, y);
  ctx.lineTo(x + tick, y);
  // Top-right
  ctx.moveTo(x + width - tick, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + tick);
  // Bottom-left
  ctx.moveTo(x, y + height - tick);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + tick, y + height);
  // Bottom-right
  ctx.moveTo(x + width - tick, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y + height - tick);
  ctx.stroke();
}

function sanitizeGutterLabel(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

function drawSlot(
  ctx: CanvasContextLike,
  bmp: BitmapLike,
  slot: PrintSheetSlot,
  gutterPx: number,
  label: string | undefined,
  cutMarks: boolean,
): void {
  const unrotatedAspect = slot.rotated ? slot.height / slot.width : slot.width / slot.height;
  const crop = computeCenteredCrop({ width: bmp.width, height: bmp.height }, unrotatedAspect);

  if (slot.rotated) {
    ctx.save();
    ctx.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(
      bmp,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -slot.height / 2,
      -slot.width / 2,
      slot.height,
      slot.width,
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      bmp,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      slot.x,
      slot.y,
      slot.width,
      slot.height,
    );
  }

  if (cutMarks) {
    drawCutMarks(ctx, slot);
  }

  const cleanLabel = sanitizeGutterLabel(label);
  if (cleanLabel) {
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    const textY = slot.y + slot.height + Math.max(12, Math.floor(gutterPx * 0.72));
    ctx.fillText(cleanLabel, slot.x + slot.width / 2, textY, slot.width);
  }
}

async function decodeSlotBitmap(blob: Blob, platform: EnginePlatform): Promise<BitmapLike> {
  const headSlice = blob.slice(0, Math.min(blob.size, 65_536));
  const headBytes = new Uint8Array(await headSlice.arrayBuffer());
  const report = inspectImageBytes(headBytes, 'slot.jpg', blob.size);

  if (report.orientedDimensions) {
    const target = computePreviewScale(report.orientedDimensions, PRINT_SLOT_MAX_EDGE);
    return platform.createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: target.width,
      resizeHeight: target.height,
    });
  }

  return platform.createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/**
 * Render a 300 DPI PNG print sheet in either single-photo (tiled) or
 * multi-photo Café/Family mode (decoding and closing one slot image at a time).
 */
export async function renderPrintSheet(
  layout: PrintSheetLayout,
  inputs: readonly PrintSheetInput[],
  platform: EnginePlatform,
  options: RenderPrintSheetOptions,
): Promise<PrintSheetResult> {
  const { mode, copies, cutMarks = true, signal } = options;
  checkAborted(signal);

  if (layout.capacity <= 0 || layout.slots.length === 0) {
    throw new RangeError('Photo size does not fit on the selected print sheet.');
  }
  if (inputs.length === 0) {
    throw new RangeError('At least one photo is required to render a print sheet.');
  }

  const count =
    mode === 'single'
      ? Math.max(1, Math.min(copies ?? layout.capacity, layout.capacity))
      : Math.max(1, Math.min(inputs.length, layout.capacity));

  let sheetCanvas: CanvasLike | null = null;
  try {
    sheetCanvas = platform.createCanvas(layout.sheetWidthPx, layout.sheetHeightPx);
    const ctx = sheetCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not acquire 2D context for print sheet.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, layout.sheetWidthPx, layout.sheetHeightPx);

    if (mode === 'single') {
      const first = inputs[0]!;
      let bmp: BitmapLike | null = null;
      try {
        bmp = await decodeSlotBitmap(first.blob, platform);
        for (let i = 0; i < count; i++) {
          checkAborted(signal);
          drawSlot(ctx, bmp, layout.slots[i]!, layout.gutterPx, first.label, cutMarks);
        }
      } finally {
        closeBitmap(bmp);
      }
    } else {
      for (let i = 0; i < count; i++) {
        checkAborted(signal);
        const item = inputs[i]!;
        let bmp: BitmapLike | null = null;
        try {
          bmp = await decodeSlotBitmap(item.blob, platform);
          drawSlot(ctx, bmp, layout.slots[i]!, layout.gutterPx, item.label, cutMarks);
        } finally {
          closeBitmap(bmp);
        }
      }
    }

    checkAborted(signal);
    const rawPng = await canvasToBytes(sheetCanvas, 'png', 1);
    const pngWithDpi = setPngDpi(rawPng, layout.dpi);

    return {
      blob: new Blob([new Uint8Array(pngWithDpi)], { type: 'image/png' }),
      bytes: pngWithDpi.length,
      width: layout.sheetWidthPx,
      height: layout.sheetHeightPx,
      dpi: layout.dpi,
      count,
      capacity: layout.capacity,
      rotated: layout.rotated,
    };
  } finally {
    releaseCanvas(sheetCanvas);
  }
}
