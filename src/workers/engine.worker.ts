import { closeBitmap, decodeWorkingBitmap } from '../engine/decode';
import { runDocumentClean } from '../engine/document';
import {
  createOffscreenPlatform,
  runExport,
  runInspect,
  runPreview,
  runResizeCompress,
} from '../engine/pipeline';
import { renderPrintSheet } from '../engine/print-sheet';
import type { BitmapLike } from '../engine/types';
import { runWebKitExport } from '../engine/web-kit';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerGlobal {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

interface CachedWorkingBitmap {
  sourceKey: string;
  maxEdge: number;
  bitmap: BitmapLike;
}

const workerScope = globalThis as unknown as WorkerGlobal;
const platform = createOffscreenPlatform();
const inflight = new Map<number, AbortController>();
let cachedWorking: CachedWorkingBitmap | null = null;

function clearCachedWorking(): void {
  if (cachedWorking) {
    closeBitmap(cachedWorking.bitmap);
    cachedWorking = null;
  }
}

function sendError(id: number, err: unknown): void {
  const aborted = err instanceof DOMException && err.name === 'AbortError';
  const message = err instanceof Error ? err.message : String(err);
  workerScope.postMessage({ id, ok: false, error: message, aborted });
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  if (req.type === 'cancel') {
    inflight.get(req.id)?.abort();
    inflight.delete(req.id);
    return;
  }

  if (req.type === 'clear-source') {
    clearCachedWorking();
    return;
  }

  const controller = new AbortController();
  inflight.set(req.id, controller);

  try {
    if (req.type === 'inspect') {
      const report = await runInspect(req.blob, req.fileName, controller.signal);
      workerScope.postMessage({ id: req.id, ok: true, type: 'inspect', report });
    } else if (req.type === 'preview') {
      const bmp = await runPreview(req.blob, req.report, platform, controller.signal);
      const nativeBmp = bmp as ImageBitmap;
      workerScope.postMessage({ id: req.id, ok: true, type: 'preview', bitmap: nativeBmp }, [
        nativeBmp,
      ]);
    } else if (req.type === 'export') {
      const { result, stats } = await runExport(
        req.blob,
        req.spec,
        req.cropRect,
        req.report,
        platform,
        { signal: controller.signal, useCropAtDecode: req.useCropAtDecode },
      );
      const buffer = await result.blob.arrayBuffer();
      const { blob, ...resultMeta } = result;
      workerScope.postMessage(
        {
          id: req.id,
          ok: true,
          type: 'export',
          buffer,
          mime: blob.type || 'image/jpeg',
          resultMeta,
          stats,
        },
        [buffer],
      );
    } else if (req.type === 'resize-compress') {
      const neededMaxEdge = Math.min(
        4000,
        Math.max(3200, req.options.targetWidth ?? 0, req.options.targetHeight ?? 0),
      );

      let working: BitmapLike;
      if (
        cachedWorking &&
        cachedWorking.sourceKey === req.sourceKey &&
        cachedWorking.maxEdge >= neededMaxEdge
      ) {
        working = cachedWorking.bitmap;
      } else {
        clearCachedWorking();
        const decoded = await decodeWorkingBitmap(
          req.blob,
          req.report.orientedDimensions,
          neededMaxEdge,
          platform,
        );
        if (controller.signal.aborted) {
          closeBitmap(decoded);
          throw new DOMException('Operation aborted', 'AbortError');
        }
        clearCachedWorking();
        cachedWorking = { sourceKey: req.sourceKey, maxEdge: neededMaxEdge, bitmap: decoded };
        working = decoded;
      }

      const { result, stats } = await runResizeCompress(
        working,
        req.options,
        req.report,
        platform,
        controller.signal,
      );
      const buffer = await result.blob.arrayBuffer();
      const { blob, ...resultMeta } = result;
      workerScope.postMessage(
        {
          id: req.id,
          ok: true,
          type: 'resize-compress',
          buffer,
          mime: blob.type || resultMeta.actualMime,
          resultMeta,
          stats,
        },
        [buffer],
      );
    } else if (req.type === 'print-sheet') {
      const sheet = await renderPrintSheet(req.layout, req.inputs, platform, {
        mode: req.mode,
        copies: req.copies,
        cutMarks: req.cutMarks,
        signal: controller.signal,
      });
      const buffer = await sheet.blob.arrayBuffer();
      const { blob: _unusedBlob, ...resultMeta } = sheet;
      void _unusedBlob;
      workerScope.postMessage(
        {
          id: req.id,
          ok: true,
          type: 'print-sheet',
          buffer,
          resultMeta,
        },
        [buffer],
      );
    } else if (req.type === 'document-clean') {
      const neededMaxEdge = Math.min(
        3600,
        Math.max(2400, req.options.targetWidth ?? 0, req.options.targetHeight ?? 0),
      );
      let working: BitmapLike;
      if (
        cachedWorking &&
        cachedWorking.sourceKey === req.sourceKey &&
        cachedWorking.maxEdge >= neededMaxEdge
      ) {
        working = cachedWorking.bitmap;
      } else {
        clearCachedWorking();
        const decoded = await decodeWorkingBitmap(
          req.blob,
          req.report.orientedDimensions,
          neededMaxEdge,
          platform,
        );
        if (controller.signal.aborted) {
          closeBitmap(decoded);
          throw new DOMException('Operation aborted', 'AbortError');
        }
        clearCachedWorking();
        cachedWorking = { sourceKey: req.sourceKey, maxEdge: neededMaxEdge, bitmap: decoded };
        working = decoded;
      }

      const cleaned = await runDocumentClean(
        working,
        req.options,
        req.report,
        platform,
        controller.signal,
      );
      const buffer = await cleaned.blob.arrayBuffer();
      const { blob, ...resultMeta } = cleaned;
      workerScope.postMessage(
        {
          id: req.id,
          ok: true,
          type: 'document-clean',
          buffer,
          mime: blob.type || resultMeta.actualMime,
          resultMeta,
        },
        [buffer],
      );
    } else if (req.type === 'web-kit') {
      const maxReqW = req.options.widths.reduce((m, w) => Math.max(m, w), 0);
      const neededMaxEdge = Math.min(4000, Math.max(2400, maxReqW));
      let working: BitmapLike;
      if (
        cachedWorking &&
        cachedWorking.sourceKey === req.sourceKey &&
        cachedWorking.maxEdge >= neededMaxEdge
      ) {
        working = cachedWorking.bitmap;
      } else {
        clearCachedWorking();
        const decoded = await decodeWorkingBitmap(
          req.blob,
          req.report.orientedDimensions,
          neededMaxEdge,
          platform,
        );
        if (controller.signal.aborted) {
          closeBitmap(decoded);
          throw new DOMException('Operation aborted', 'AbortError');
        }
        clearCachedWorking();
        cachedWorking = { sourceKey: req.sourceKey, maxEdge: neededMaxEdge, bitmap: decoded };
        working = decoded;
      }

      const kit = await runWebKitExport(
        working,
        req.options,
        req.report,
        platform,
        controller.signal,
      );
      const buffers = await Promise.all(kit.assets.map((a) => a.blob.arrayBuffer()));
      const assetsMeta = kit.assets.map(({ blob: _b, ...rest }) => {
        void _b;
        return rest;
      });
      const { assets: _unusedAssets, ...resultMeta } = kit;
      void _unusedAssets;
      workerScope.postMessage(
        {
          id: req.id,
          ok: true,
          type: 'web-kit',
          assetsMeta,
          buffers,
          resultMeta,
        },
        buffers,
      );
    }
  } catch (err) {
    sendError(req.id, err);
  } finally {
    inflight.delete(req.id);
  }
};
