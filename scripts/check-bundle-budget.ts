import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');
const BUNDLE_JSON = join(process.cwd(), 'specs', 'bundle.json');

const MAX_CORE_JS_GZIP = 80 * 1024;
const MAX_WORKER_JS_GZIP = 20 * 1024;
const MAX_SPECS_GZIP = 3 * 1024;

function main(): void {
  const files = readdirSync(DIST_ASSETS).sort();
  let coreJsGzip = 0;
  let workerJsGzip = 0;

  for (const file of files) {
    if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
    const buf = readFileSync(join(DIST_ASSETS, file));
    const gz = gzipSync(buf).byteLength;
    console.log(`${file}: ${buf.byteLength} B raw, ${gz} B gzip`);

    if (file.endsWith('.js')) {
      if (file.includes('worker')) {
        workerJsGzip += gz;
      } else {
        coreJsGzip += gz;
      }
    }
  }

  const specsGz = gzipSync(readFileSync(BUNDLE_JSON)).byteLength;
  console.log(`specs/bundle.json: ${specsGz} B gzip`);

  if (coreJsGzip === 0 || coreJsGzip > MAX_CORE_JS_GZIP) {
    throw new Error(`Core JS gzip (${coreJsGzip} B) outside (0, ${MAX_CORE_JS_GZIP}] budget`);
  }
  if (workerJsGzip > MAX_WORKER_JS_GZIP) {
    throw new Error(`Worker JS gzip (${workerJsGzip} B) exceeds ${MAX_WORKER_JS_GZIP} B budget`);
  }
  if (specsGz >= MAX_SPECS_GZIP) {
    throw new Error(`Specs bundle gzip (${specsGz} B) exceeds ${MAX_SPECS_GZIP} B budget`);
  }
}

main();
