import type { ComponentType } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import { APP_BASE_NO_SLASH, appHref } from '../ui/base-url';

export type AppRoute =
  '/' | '/batch' | '/compare' | '/documents' | '/presets' | '/web-kit' | '/inspect' | '/print';

function stripAppBase(pathname: string): string {
  if (!APP_BASE_NO_SLASH) return pathname || '/';
  const lowerPath = pathname.toLowerCase();
  const lowerBase = APP_BASE_NO_SLASH.toLowerCase();
  if (lowerPath === lowerBase) return '/';
  if (lowerPath.startsWith(`${lowerBase}/`)) {
    return pathname.slice(lowerBase.length) || '/';
  }
  return pathname || '/';
}

export function normalizeRoute(pathname: string): AppRoute {
  const clean = stripAppBase(pathname).replace(/\/+$/, '') || '/';
  if (clean === '/batch') return '/batch';
  if (clean === '/compare') return '/compare';
  if (clean === '/documents') return '/documents';
  if (clean === '/presets') return '/presets';
  if (clean === '/web-kit') return '/web-kit';
  if (clean === '/inspect') return '/inspect';
  if (clean === '/print') return '/print';
  return '/';
}

export function useRoute(): {
  route: AppRoute;
  navigate: (target: AppRoute, search?: string) => void;
} {
  const [route, setRoute] = useState<AppRoute>(() => normalizeRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((target: AppRoute, search = '') => {
    const nextUrl = `${appHref(target)}${search}`;
    const currentUrl = `${appHref(normalizeRoute(window.location.pathname))}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.pushState(null, '', nextUrl);
    }
    setRoute(target);
    window.scrollTo?.(0, 0);
  }, []);

  return { route, navigate };
}

/** Zero-dep dynamic import wrapper for lazy-loading route pages into separate chunks. */
export function createLazyComponent<P extends object>(
  loader: () => Promise<ComponentType<P>>,
): (props: P) => preact.JSX.Element {
  let cached: ComponentType<P> | null = null;

  return function LazyRoute(props: P) {
    const [Comp, setComp] = useState<ComponentType<P> | null>(() => cached);

    useEffect(() => {
      if (cached) {
        if (!Comp) setComp(() => cached);
        return;
      }
      let active = true;
      void loader().then((loaded) => {
        cached = loaded;
        if (active) setComp(() => loaded);
      });
      return () => {
        active = false;
      };
    }, [Comp]);

    if (!Comp) {
      return <p class="route-loading">Loading view…</p>;
    }
    return <Comp {...props} />;
  };
}
