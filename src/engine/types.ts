export type Units = 'px' | 'mm';
export type SpecStatus = 'draft' | 'community' | 'checked' | 'stale';
export type OutputFormat = 'jpeg' | 'webp' | 'png';
export type FitMode = 'inside' | 'fill' | 'pad' | 'stretch';
export type PadBackdropStyle = 'blur' | 'edge' | 'white' | 'dark';
export type QualityBand = 'crisp' | 'good' | 'artifacted';
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

export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
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

export interface FitOptions {
  targetWidth: number | null;
  targetHeight: number | null;
  fit: FitMode;
  dontEnlarge: boolean;
  focalX?: number;
  focalY?: number;
}

export interface FitPlan {
  sourceRect: Rect;
  destRect: Rect;
  outputDims: Dimensions;
  effectiveFit: FitMode;
  wasClampedToSafeArea: boolean;
  cropped: boolean;
}

export interface EnhanceOptions {
  autoContrast: boolean;
  sharpenPct: number;
}

export interface QualityAssessment {
  psnr: number;
  band: QualityBand;
  suggestWebp: boolean;
}

export type DocumentColorMode = 'color-clean' | 'grayscale' | 'bw';

export interface DocumentCleanOptions {
  targetWidth: number | null;
  targetHeight: number | null;
  mode: DocumentColorMode;
  levelStrength: number;
  whitenPaper: number;
  sharpenPct: number;
  bwBias?: number;
  format: OutputFormat;
  quality: number;
  maxKb: number | null;
}

export interface DocumentCleanResult {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  requestedFormat: OutputFormat;
  actualFormat: OutputFormat;
  actualMime: string;
  quality: number;
  status: EncodeStatus;
  shrunkToFitKb: boolean;
  leveledApplied: boolean;
  wasClampedToSafeArea: boolean;
}

export interface WebKitOptions {
  widths: readonly number[];
  includeWebp: boolean;
  includeJpeg: boolean;
  includeLqip: boolean;
  quality: number;
  autoContrast: boolean;
  sharpenPct: number;
  assetPrefix: string;
  altText: string;
  sizesAttr: string;
  baseName: string;
}

export interface WebKitAsset {
  filename: string;
  width: number;
  height: number;
  format: OutputFormat;
  mime: string;
  bytes: number;
  blob: Blob;
}

export interface WebKitResult {
  stem: string;
  sourceWidth: number;
  sourceHeight: number;
  assets: WebKitAsset[];
  lqipDataUri: string | null;
  lqipWidth: number;
  lqipHeight: number;
  lqipBytes: number;
  pictureHtml: string;
}

export interface ResizeCompressOptions {
  targetWidth: number | null;
  targetHeight: number | null;
  fit: FitMode;
  dontEnlarge: boolean;
  focalX?: number;
  focalY?: number;
  autoFocus?: boolean;
  backdrop?: PadBackdropStyle;
  format: OutputFormat;
  quality: number;
  minKb: number | null;
  maxKb: number | null;
  dpi: number | null;
  autoContrast: boolean;
  sharpenPct: number;
  allowShrinkToFitKb?: boolean;
  assessQuality?: boolean;
}

export interface ResizeCompressResult {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  requestedFormat: OutputFormat;
  actualFormat: OutputFormat;
  actualMime: string;
  dpi: number | null;
  quality: number;
  iterations: number;
  status: EncodeStatus;
  paddedBytes: number;
  shrunkToFitKb: boolean;
  contrastApplied: boolean;
  sharpenApplied: boolean;
  cropped: boolean;
  wasClampedToSafeArea: boolean;
  appliedFocalX: number;
  appliedFocalY: number;
  qualityAssessment: QualityAssessment | null;
}

export interface ResizeCompressStats {
  decodeMs: number;
  enhanceMs: number;
  encodeMs: number;
  totalMs: number;
  inputBytes: number;
  outputBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  format: OutputFormat;
  quality: number;
  iterations: number;
  status: EncodeStatus;
  contrastApplied: boolean;
  sharpenApplied: boolean;
  fixedIssues: string[];
  outboundBytes: 0;
}

export interface SizePreset {
  id: string;
  group: 'general' | 'portal' | 'saved';
  label: string;
  width: number | null;
  height: number | null;
  fit: FitMode;
  backdrop?: PadBackdropStyle;
  format?: OutputFormat;
  minKb?: number | null;
  maxKb?: number | null;
  dpi?: number | null;
  autoContrast?: boolean;
  sharpenPct?: number;
  backgroundHint?: string | null;
  note?: string | null;
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
  imageSmoothingEnabled?: boolean;
  imageSmoothingQuality?: 'low' | 'medium' | 'high';
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: BitmapLike | CanvasLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  getImageData?(sx: number, sy: number, sw: number, sh: number): ImageDataLike;
  putImageData?(imageData: ImageDataLike, dx: number, dy: number): void;
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
