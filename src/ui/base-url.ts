function normalizeBase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

export const APP_BASE = normalizeBase(import.meta.env.BASE_URL || '/');
export const APP_BASE_NO_SLASH = APP_BASE === '/' ? '' : APP_BASE.slice(0, -1);

/** Prefix an internal app or static asset path with Vite's configured base URL. */
export function appHref(path: string): string {
  const rel = path.replace(/^\/+/, '');
  return rel ? `${APP_BASE}${rel}` : APP_BASE;
}
