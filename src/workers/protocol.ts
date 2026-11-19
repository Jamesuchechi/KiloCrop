import type { PrintSheetInput } from '../engine/print-sheet';
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

export type WorkerRequest =
  | {
      id: number;
      type: 'inspect';
      blob: Blob;
      fileName: string;
    }
  | {
      id: number;
      type: 'preview';
      blob: Blob;
      report: InspectReport;
    }
  | {
      id: number;
      type: 'export';
      blob: Blob;
      spec: Spec;
      cropRect: Rect | null;
      report: InspectReport;
      useCropAtDecode?: boolean;
    }
  | {
      id: number;
      type: 'print-sheet';
      layout: PrintSheetLayout;
      inputs: PrintSheetInput[];
      mode: 'single' | 'multi';
      copies?: number;
      cutMarks?: boolean;
    }
  | {
      id: number;
      type: 'cancel';
    };

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      type: 'inspect';
      report: InspectReport;
    }
  | {
      id: number;
      ok: true;
      type: 'preview';
      bitmap: ImageBitmap;
    }
  | {
      id: number;
      ok: true;
      type: 'export';
      buffer: ArrayBuffer;
      mime: string;
      resultMeta: Omit<EncodeResult, 'blob'>;
      stats: PipelineStats;
    }
  | {
      id: number;
      ok: true;
      type: 'print-sheet';
      buffer: ArrayBuffer;
      resultMeta: Omit<PrintSheetResult, 'blob'>;
    }
  | {
      id: number;
      ok: false;
      error: string;
      aborted: boolean;
    };

export interface EngineClient {
  readonly mode: 'worker' | 'main-thread';
  inspect(blob: Blob, fileName: string, signal?: AbortSignal): Promise<InspectReport>;
  preview(blob: Blob, report: InspectReport, signal?: AbortSignal): Promise<BitmapLike>;
  exportPhoto(
    blob: Blob,
    spec: Spec,
    cropRect: Rect | null,
    report: InspectReport,
    options?: { signal?: AbortSignal; useCropAtDecode?: boolean },
  ): Promise<{ result: EncodeResult; stats: PipelineStats }>;
  printSheet(
    layout: PrintSheetLayout,
    inputs: PrintSheetInput[],
    options: {
      mode: 'single' | 'multi';
      copies?: number;
      cutMarks?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<PrintSheetResult>;
  dispose(): void;
}
