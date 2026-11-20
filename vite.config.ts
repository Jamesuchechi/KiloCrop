import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

function normalizeBasePath(raw?: string): string {
  const trimmed = (raw ?? '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

function injectProdCsp(basePath: string): Plugin {
  return {
    name: 'kilocrop-prod-csp',
    apply: 'build',
    transformIndexHtml(html) {
      let nextHtml = html;
      if (basePath !== '/') {
        nextHtml = nextHtml
          .replace('href="/manifest.webmanifest"', `href="${basePath}manifest.webmanifest"`)
          .replace('href="/icons/icon.svg"', `href="${basePath}icons/icon.svg"`);
      }
      return {
        html: nextHtml,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: PROD_CSP,
            },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

const basePath = normalizeBasePath(process.env.BASE_PATH);

export default defineConfig({
  base: basePath,
  plugins: [preact(), injectProdCsp(basePath)],
  server: {
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 80,
        pollInterval: 20,
      },
    },
  },
  worker: {
    format: 'es',
  },
});
