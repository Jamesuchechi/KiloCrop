import { runExport, runInspect, runPreview } from '../engine/pipeline';
import { renderPrintSheet, type PrintSheetInput } from '../engine/print-sheet';
import type {
  BitmapLike,
  CanvasLike,
  EncodeResult,
  EnginePlatform,
  InspectReport,
  PipelineStats,
  PrintSheetLayout,
  PrintSheetResult,
  Rect,
  Spec,
} from '../engine/types';
import type { EngineClient, WorkerRequest, WorkerResponse } from './protocol';

function createDomFallbackPlatform(): EnginePlatform {
  return {
    createImageBitmap: (source, options) => createImageBitmap(source, options),
    createCroppedImageBitmap: (source, sx, sy, sw, sh, options) =>
      createImageBitmap(source, sx, sy, sw, sh, options),
    createCanvas(width, height): CanvasLike {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as CanvasLike;
    },
  };
}

function canUseOffscreenWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

function createWorkerClient(): EngineClient {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
    type: 'module',
  });
  let nextId = 1;

  interface PendingJob {
    resolve: (res: Extract<WorkerResponse, { ok: true }>) => void;
    reject: (err: Error) => void;
    cleanup?: () => void;
  }

  const pending = new Map<number, PendingJob>();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const res = event.data;
    const job = pending.get(res.id);
    if (!job) return;
    pending.delete(res.id);
    job.cleanup?.();

    if (res.ok) {
      job.resolve(res);
    } else if (res.aborted) {
      job.reject(new DOMException(res.error || 'Operation aborted', 'AbortError'));
    } else {
      job.reject(new Error(res.error || 'Worker failure'));
    }
  };

  worker.onerror = (err) => {
    for (const [id, job] of pending.entries()) {
      pending.delete(id);
      job.cleanup?.();
      job.reject(new Error(err.message || 'Worker crashed'));
    }
  };

  function callWorker(
    buildReq: (id: number) => WorkerRequest,
    signal?: AbortSignal,
  ): Promise<Extract<WorkerResponse, { ok: true }>> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Operation aborted', 'AbortError'));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        worker.postMessage({ id, type: 'cancel' } satisfies WorkerRequest);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      });
      worker.postMessage(buildReq(id));
    });
  }

  return {
    mode: 'worker',
    async inspect(blob, fileName, signal) {
      const res = await callWorker((id) => ({ id, type: 'inspect', blob, fileName }), signal);
      if (res.type !== 'inspect') throw new Error('Unexpected worker response');
      return res.report;
    },
    async preview(blob, report, signal) {
      const res = await callWorker((id) => ({ id, type: 'preview', blob, report }), signal);
      if (res.type !== 'preview') throw new Error('Unexpected worker response');
      return res.bitmap;
    },
    async exportPhoto(blob, spec, cropRect, report, options) {
      const res = await callWorker(
        (id) => ({
          id,
          type: 'export',
          blob,
          spec,
          cropRect,
          report,
          useCropAtDecode: options?.useCropAtDecode,
        }),
        options?.signal,
      );
      if (res.type !== 'export') throw new Error('Unexpected worker response');
      return {
        result: {
          ...res.resultMeta,
          blob: new Blob([res.buffer], { type: res.mime }),
        },
        stats: res.stats,
      };
    },
    async printSheet(layout, inputs, options) {
      const res = await callWorker(
        (id) => ({
          id,
          type: 'print-sheet',
          layout,
          inputs,
          mode: options.mode,
          copies: options.copies,
          cutMarks: options.cutMarks,
        }),
        options.signal,
      );
      if (res.type !== 'print-sheet') throw new Error('Unexpected worker response');
      return {
        ...res.resultMeta,
        blob: new Blob([res.buffer], { type: 'image/png' }),
      };
    },
    dispose() {
      for (const [id, job] of pending.entries()) {
        pending.delete(id);
        job.cleanup?.();
        job.reject(new DOMException('Engine disposed', 'AbortError'));
      }
      worker.terminate();
    },
  };
}

function createMainThreadClient(): EngineClient {
  const platform = createDomFallbackPlatform();
  return {
    mode: 'main-thread',
    inspect: (blob, fileName, signal) => runInspect(blob, fileName, signal),
    preview: (blob, report, signal): Promise<BitmapLike> =>
      runPreview(blob, report, platform, signal),
    exportPhoto: (
      blob: Blob,
      spec: Spec,
      cropRect: Rect | null,
      report: InspectReport,
      options?: { signal?: AbortSignal; useCropAtDecode?: boolean },
    ): Promise<{ result: EncodeResult; stats: PipelineStats }> =>
      runExport(blob, spec, cropRect, report, platform, options),
    printSheet: (
      layout: PrintSheetLayout,
      inputs: PrintSheetInput[],
      options: {
        mode: 'single' | 'multi';
        copies?: number;
        cutMarks?: boolean;
        signal?: AbortSignal;
      },
    ): Promise<PrintSheetResult> => renderPrintSheet(layout, inputs, platform, options),
    dispose() {
      // No background thread to terminate.
    },
  };
}

/** Create an EngineClient using a single Web Worker when supported, else main-thread fallback. */
export function createEngineClient(): EngineClient {
  if (canUseOffscreenWorker()) {
    return createWorkerClient();
  }
  return createMainThreadClient();
}
