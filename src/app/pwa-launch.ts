import { appHref } from '../ui/base-url';

interface LaunchParamsLike {
  files?: ReadonlyArray<{
    getFile(): Promise<File>;
  }>;
}

interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueueLike;
  }
}

type LaunchSubscriber = (files: File[]) => void;

const pendingFiles: File[] = [];
let subscriber: LaunchSubscriber | null = null;
let initialized = false;

/** Register OS File Handling API consumer once on app startup (0 persistence). */
export function initPwaLaunchConsumer(): void {
  if (initialized || typeof window === 'undefined' || !window.launchQueue?.setConsumer) {
    return;
  }
  initialized = true;
  window.launchQueue.setConsumer((params) => {
    const handles = params.files;
    if (!handles || handles.length === 0) return;

    void Promise.all(handles.map((h) => h.getFile()))
      .then((files) => {
        const valid = files.filter((f) => f && f.size > 0);
        if (valid.length === 0) return;
        if (subscriber) {
          subscriber(valid);
        } else {
          pendingFiles.push(...valid);
        }
      })
      .catch(() => {
        // Ignore unreadable OS file handles cleanly.
      });
  });
}

/** Subscribe to incoming OS file launches and drain any buffered launch files immediately. */
export function subscribeLaunchFiles(handler: LaunchSubscriber): () => void {
  subscriber = handler;
  if (pendingFiles.length > 0) {
    const drained = pendingFiles.splice(0, pendingFiles.length);
    handler(drained);
  }
  return () => {
    if (subscriber === handler) {
      subscriber = null;
    }
  };
}

/** Read and immediately purge a shared photo received via Service Worker share_target. */
export async function consumeSharedTargetFile(): Promise<File | null> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('shared')) return null;

  params.delete('shared');
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
  window.history.replaceState(null, '', nextUrl);

  try {
    const cache = await caches.open('kilocrop-share-tmp');
    const match = await cache.match(appHref('/__kilocrop_shared_image__'));
    await caches.delete('kilocrop-share-tmp');
    if (!match) return null;

    const blob = await match.blob();
    const rawName = match.headers.get('X-KiloCrop-Filename');
    const filename = rawName ? decodeURIComponent(rawName) : 'shared-image.jpg';
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}
