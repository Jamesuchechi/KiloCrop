import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Spec } from '../src/engine/types.ts';

const SPECS_DIR = join(process.cwd(), 'specs');
const SKIP_FILES = new Set(['bundle.json', 'schema.json', '_template.json']);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BUNDLE_GZIP_BYTES = 3072;

const REGION_ORDER: Record<string, number> = {
  NG: 0,
  US: 1,
  UK: 2,
  INTL: 3,
};

const STATUS_ORDER: Record<string, number> = {
  checked: 0,
  community: 1,
  stale: 2,
};

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

function validateSpec(spec: Spec, file: string): void {
  const prefix = `[${file}]`;
  assert(ID_RE.test(spec.id), `${prefix} id must be kebab-case`);
  assert(`${spec.id}.json` === file, `${prefix} filename must match spec.id (${spec.id}.json)`);
  assert(spec.schemaVersion === 1, `${prefix} schemaVersion must be 1`);
  assert(
    typeof spec.title === 'string' && spec.title.trim().length >= 2,
    `${prefix} title required`,
  );
  assert(/^[A-Z]{2,4}$/.test(spec.region), `${prefix} region must be 2-4 uppercase letters`);
  assert(
    spec.status === 'draft' ||
      spec.status === 'community' ||
      spec.status === 'checked' ||
      spec.status === 'stale',
    `${prefix} invalid status "${spec.status}"`,
  );

  const out = spec.output;
  assert(out.units === 'px' || out.units === 'mm', `${prefix} units must be px or mm`);
  assert(Number.isFinite(out.width) && out.width > 0, `${prefix} width must be > 0`);
  assert(Number.isFinite(out.height) && out.height > 0, `${prefix} height must be > 0`);
  if (out.units === 'mm') {
    assert(
      out.dpi !== null && Number.isInteger(out.dpi) && out.dpi >= 72 && out.dpi <= 1200,
      `${prefix} mm specs require integer dpi in [72, 1200]`,
    );
  } else if (out.dpi !== null) {
    assert(
      Number.isInteger(out.dpi) && out.dpi >= 72 && out.dpi <= 1200,
      `${prefix} dpi must be integer in [72, 1200] when set`,
    );
  }
  assert(out.format === 'jpeg' || out.format === 'png', `${prefix} format must be jpeg or png`);

  const { min, max } = out.fileSizeKb;
  if (min !== null) assert(Number.isFinite(min) && min >= 1, `${prefix} min KB must be >= 1`);
  if (max !== null) assert(Number.isFinite(max) && max >= 1, `${prefix} max KB must be >= 1`);
  if (min !== null && max !== null) {
    assert(min <= max, `${prefix} fileSizeKb.min (${min}) > max (${max})`);
  }

  if (spec.framing?.headHeightPct) {
    const [a, b] = spec.framing.headHeightPct;
    assert(a >= 0 && b <= 100 && a <= b, `${prefix} invalid headHeightPct`);
  }
  if (spec.framing?.eyeLineFromTopPct) {
    const [a, b] = spec.framing.eyeLineFromTopPct;
    assert(a >= 0 && b <= 100 && a <= b, `${prefix} invalid eyeLineFromTopPct`);
  }

  const prov = spec.provenance;
  assert(
    prov.kind === 'public-page' ||
      prov.kind === 'authenticated-portal' ||
      prov.kind === 'pasted-rule' ||
      prov.kind === 'shared-query',
    `${prefix} invalid provenance.kind`,
  );
  if (prov.sourceUrl !== null) {
    assert(prov.sourceUrl.startsWith('https://'), `${prefix} sourceUrl must be https://`);
  }
  if (prov.archiveUrl !== null) {
    assert(prov.archiveUrl.startsWith('https://'), `${prefix} archiveUrl must be https://`);
  }
  if (prov.verifiedOn !== null) {
    assert(DATE_RE.test(prov.verifiedOn), `${prefix} verifiedOn must be YYYY-MM-DD`);
  }

  if (spec.status === 'checked') {
    assert(prov.verifiedOn !== null, `${prefix} checked spec requires verifiedOn`);
    if (prov.kind === 'public-page') {
      assert(prov.sourceUrl !== null, `${prefix} checked public-page spec requires sourceUrl`);
    }
  }
}

function main(): void {
  const files = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.json') && !SKIP_FILES.has(f))
    .sort();

  const seenIds = new Set<string>();
  const published: Spec[] = [];

  for (const file of files) {
    const raw = readFileSync(join(SPECS_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as Spec;
    validateSpec(parsed, file);
    assert(!seenIds.has(parsed.id), `Duplicate spec id: ${parsed.id}`);
    seenIds.add(parsed.id);

    if (parsed.status !== 'draft') {
      published.push(parsed);
    }
  }

  published.sort((a, b) => {
    const ra = REGION_ORDER[a.region] ?? 99;
    const rb = REGION_ORDER[b.region] ?? 99;
    if (ra !== rb) return ra - rb;
    const sa = STATUS_ORDER[a.status] ?? 99;
    const sb = STATUS_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });

  const bundleJson = `${JSON.stringify(published, null, 2)}\n`;
  const gzipBytes = gzipSync(bundleJson).byteLength;
  assert(
    gzipBytes < MAX_BUNDLE_GZIP_BYTES,
    `specs/bundle.json gzip size (${gzipBytes} B) exceeds ${MAX_BUNDLE_GZIP_BYTES} B limit`,
  );

  writeFileSync(join(SPECS_DIR, 'bundle.json'), bundleJson, 'utf8');
  console.log(
    `Validated ${files.length} spec files (${published.length} published). specs/bundle.json: ${Buffer.byteLength(bundleJson)} B raw, ${gzipBytes} B gzip.`,
  );
}

main();
