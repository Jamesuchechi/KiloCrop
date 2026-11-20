import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const DIST_DIR = resolve(process.cwd(), 'dist');
const HEADERS_FILE = resolve(process.cwd(), 'public', '_headers');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function parseGlobalHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(HEADERS_FILE)) return out;
  const lines = readFileSync(HEADERS_FILE, 'utf8').split(/\r?\n/);
  let inRoot = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      inRoot = false;
      continue;
    }
    if (trimmed === '/*') {
      inRoot = true;
      continue;
    }
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inRoot = false;
      continue;
    }
    if (inRoot) {
      const idx = trimmed.indexOf(':');
      if (idx > 0) {
        out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  }
  return out;
}

const securityHeaders = parseGlobalHeaders();

const server = createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
  let filePath = resolve(DIST_DIR, urlPath.replace(/^\/+/, ''));

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }
  if (!existsSync(filePath)) {
    if (/^\/(print|inspect|batch|compare|documents|presets|web-kit)\/?$/.test(urlPath)) {
      filePath = join(DIST_DIR, 'index.html');
    } else {
      res.writeHead(404).end('Not found');
      return;
    }
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    ...securityHeaders,
    'Content-Type': contentType,
  };
  if (urlPath === '/sw.js') {
    headers['Cache-Control'] = 'no-cache';
  }
  res.writeHead(200, headers);
  res.end(readFileSync(filePath));
});

server.listen(PORT, HOST, () => {
  console.log(`Serving dist/ on http://${HOST}:${PORT}`);
});
