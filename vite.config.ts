import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

function injectProdCsp(): Plugin {
  return {
    name: 'kilocrop-prod-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
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

export default defineConfig({
  plugins: [preact(), injectProdCsp()],
  worker: {
    format: 'es',
  },
});
