export type Units = 'px' | 'mm';
export type SpecStatus = 'draft' | 'community' | 'checked' | 'stale';
export type OutputFormat = 'jpeg' | 'png';
export type ProvenanceKind =
  'public-page' | 'authenticated-portal' | 'pasted-rule' | 'shared-query';

export interface Spec {
  id: string;
  schemaVersion: 1;
  title: string;
  shortLabel?: string;
  region: string;
  tags?: string[];
  status: SpecStatus;
  output: {
    units: Units;
    width: number;
    height: number;
    dpi: number | null;
    format: OutputFormat;
    fileSizeKb: {
      min: number | null;
      max: number | null;
    };
  };
  backgroundHint?: string | null;
  framing?: {
    headHeightPct?: [number, number];
    eyeLineFromTopPct?: [number, number];
  };
  provenance: {
    kind: ProvenanceKind;
    sourceUrl: string | null;
    archiveUrl: string | null;
    verifiedOn: string | null;
    notes?: string | null;
  };
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageContainer = 'jpeg' | 'png' | 'webp' | 'heic' | 'unknown';

export type HiddenIssueCode =
  | 'progressive-jpeg'
  | 'exif-orientation'
  | 'extension-mismatch'
  | 'heic-container'
  | 'non-srgb-icc'
  | 'cmyk-color'
  | 'whatsapp-compressed';

export interface InspectIssue {
  code: HiddenIssueCode;
  severity: 'auto-fixed' | 'advisory' | 'blocking';
  title: string;
  detail: string;
}

export interface InspectReport {
  container: ImageContainer;
  fileName: string;
  fileBytes: number;
  rawDimensions: Dimensions | null;
  orientedDimensions: Dimensions | null;
  orientation: number;
  isProgressiveJpeg: boolean;
  hasExif: boolean;
  hasGpsExif: boolean;
  iccProfile: 'srgb' | 'display-p3' | 'other' | 'none';
  isCmyk: boolean;
  issues: InspectIssue[];
}

export type EncodeStatus = 'ok' | 'padded-min' | 'below-min' | 'infeasible-max';

export interface EncodeResult {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  dpi: number | null;
  quality: number;
  iterations: number;
  status: EncodeStatus;
  paddedBytes: number;
}

export interface PipelineStats {
  decodeMs: number;
  encodeMs: number;
  totalMs: number;
  inputBytes: number;
  outputBytes: number;
  outputWidth: number;
  outputHeight: number;
  quality: number;
  iterations: number;
  status: EncodeStatus;
  fixedIssues: string[];
  outboundBytes: 0;
}

export interface BitmapLike {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface CanvasContextLike {
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: 'left' | 'center' | 'right' | 'start' | 'end';
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: BitmapLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

export type PrintSheetPresetId = '4x6' | '5x7' | 'a4';

export interface PrintSheetSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  row: number;
  col: number;
}

export interface PrintSheetLayout {
  sheetId: PrintSheetPresetId;
  sheetWidthPx: number;
  sheetHeightPx: number;
  dpi: number;
  marginPx: number;
  gutterPx: number;
  photoWidthPx: number;
  photoHeightPx: number;
  cols: number;
  rows: number;
  capacity: number;
  rotated: boolean;
  slots: PrintSheetSlot[];
}

export interface PrintSheetResult {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  dpi: number;
  count: number;
  capacity: number;
  rotated: boolean;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasContextLike | null;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface EnginePlatform {
  createImageBitmap(
    source: Blob,
    options?: {
      imageOrientation?: 'from-image' | 'none';
      resizeWidth?: number;
      resizeHeight?: number;
    },
  ): Promise<BitmapLike>;
  createCroppedImageBitmap?(
    source: Blob,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    options?: {
      imageOrientation?: 'from-image' | 'none';
      resizeWidth?: number;
      resizeHeight?: number;
    },
  ): Promise<BitmapLike>;
  createCanvas(width: number, height: number): CanvasLike;
}
