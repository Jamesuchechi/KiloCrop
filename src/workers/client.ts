import { closeBitmap, decodeWorkingBitmap } from '../engine/decode';
import { runDocumentClean } from '../engine/document';
import { runExport, runInspect, runPreview, runResizeCompress } from '../engine/pipeline';
import { renderPrintSheet, type PrintSheetInput } from '../engine/print-sheet';
import type {
  BitmapLike,
  CanvasLike,
  DocumentCleanOptions,
  EncodeResult,
  EnginePlatform,
  InspectReport,
  PipelineStats,
  PrintSheetLayout,
  PrintSheetResult,
  Rect,
  ResizeCompressOptions,
  Spec,
  WebKitOptions,
} from '../engine/types';
import { runWebKitExport } from '../engine/web-kit';
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
    async resizeCompress(sourceKey, blob, options, report, signal) {
      const res = await callWorker(
        (id) => ({
          id,
          type: 'resize-compress',
          sourceKey,
          blob,
          options,
          report,
        }),
        signal,
      );
      if (res.type !== 'resize-compress') throw new Error('Unexpected worker response');
      return {
        result: {
          ...res.resultMeta,
          blob: new Blob([res.buffer], { type: res.mime }),
        },
        stats: res.stats,
      };
    },
    clearSource() {
      worker.postMessage({ id: nextId++, type: 'clear-source' } satisfies WorkerRequest);
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
    async documentClean(sourceKey, blob, options, report, signal) {
      const res = await callWorker(
        (id) => ({ id, type: 'document-clean', sourceKey, blob, options, report }),
        signal,
      );
      if (res.type !== 'document-clean') throw new Error('Unexpected worker response');
      return {
        ...res.resultMeta,
        blob: new Blob([res.buffer], { type: res.mime }),
      };
    },
    async webKitExport(sourceKey, blob, options, report, signal) {
      const res = await callWorker(
        (id) => ({ id, type: 'web-kit', sourceKey, blob, options, report }),
        signal,
      );
      if (res.type !== 'web-kit') throw new Error('Unexpected worker response');
      return {
        ...res.resultMeta,
        assets: res.assetsMeta.map((meta, idx) => ({
          ...meta,
          blob: new Blob([res.buffers[idx]!], { type: meta.mime }),
        })),
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
  let cachedWorking: { sourceKey: string; maxEdge: number; bitmap: BitmapLike } | null = null;

  function clearCachedWorking(): void {
    if (cachedWorking) {
      closeBitmap(cachedWorking.bitmap);
      cachedWorking = null;
    }
  }

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
    async resizeCompress(
      sourceKey: string,
      blob: Blob,
      options: ResizeCompressOptions,
      report: InspectReport,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }
      const neededMaxEdge = Math.min(
        4000,
        Math.max(3200, options.targetWidth ?? 0, options.targetHeight ?? 0),
      );
      let working: BitmapLike;
      if (
        cachedWorking &&
        cachedWorking.sourceKey === sourceKey &&
        cachedWorking.maxEdge >= neededMaxEdge
      ) {
        working = cachedWorking.bitmap;
      } else {
        clearCachedWorking();
        const decoded = await decodeWorkingBitmap(
          blob,
          report.orientedDimensions,
          neededMaxEdge,
          platform,
        );
        if (signal?.aborted) {
          closeBitmap(decoded);
          throw new DOMException('Operation aborted', 'AbortError');
        }
        clearCachedWorking();
        cachedWorking = { sourceKey, maxEdge: neededMaxEdge, bitmap: decoded };
        working = decoded;
      }
      return runResizeCompress(working, options, report, platform, signal);
    },
    clearSource() {
      clearCachedWorking();
    },
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
    async documentClean(
      sourceKey: string,
      blob: Blob,
      options: DocumentCleanOptions,
      report: InspectReport,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }
      const neededMaxEdge = Math.min(
        3600,
        Math.max(2400, options.targetWidth ?? 0, options.targetHeight ?? 0),
      );
      let working: BitmapLike;
      if (
        cachedWorking &&
        cachedWorking.sourceKey === sourceKey &&
        cachedWorking.maxEdge >= neededMaxEdge
      ) {
        working = cachedWorking.bitmap;
      } else {
        clearCachedWorking();
        const decoded = await decodeWorkingBitmap(
          blob,
          report.orientedDimensions,
          neededMaxEdge,
          platform,
        );
        if (signal?.aborted) {
          closeBitmap(decoded);
          throw new DOMException('Operation aborted', 'AbortError');
        }
        clearCachedWorking();
        cachedWorking = { sourceKey, maxEdge: neededMaxEdge, bitmap: decoded };
        working = decoded;
      }
      return runDocumentClean(working, options, report, platform, signal);
    },
    async webKitExport(
      sourceKey: string,
      blob: Blob,
      options: WebKitOptions,
      report: InspectReport,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }
      const maxReqW = options.widths.reduce((m, w) => Math.max(m, w), 0);
      const neededMaxEdge = Math.min(4000, Math.max(2400, maxReqW));
      let working: BitmapLike;
      if (
        cachedWorking &&
        cachedWorking.sourceKey === sourceKey &&
        cachedWorking.maxEdge >= neededMaxEdge
      ) {
        working = cachedWorking.bitmap;
      } else {
        clearCachedWorking();
        const decoded = await decodeWorkingBitmap(
          blob,
          report.orientedDimensions,
          neededMaxEdge,
          platform,
        );
        if (signal?.aborted) {
          closeBitmap(decoded);
          throw new DOMException('Operation aborted', 'AbortError');
        }
        clearCachedWorking();
        cachedWorking = { sourceKey, maxEdge: neededMaxEdge, bitmap: decoded };
        working = decoded;
      }
      return runWebKitExport(working, options, report, platform, signal);
    },
    dispose() {
      clearCachedWorking();
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
