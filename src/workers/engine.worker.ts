import { createOffscreenPlatform, runExport, runInspect, runPreview } from '../engine/pipeline';
import { renderPrintSheet } from '../engine/print-sheet';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerGlobal {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerGlobal;
const platform = createOffscreenPlatform();
const inflight = new Map<number, AbortController>();

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
    }
  } catch (err) {
    sendError(req.id, err);
  } finally {
    inflight.delete(req.id);
  }
};
