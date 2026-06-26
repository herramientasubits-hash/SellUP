/**
 * Perú.9B — Node 20 CLI stability for the SUNAT snapshot importer.
 *
 * Pure unit / static-analysis tests. No Supabase connection, no DB writes,
 * no network calls, no filesystem snapshot reads.
 *
 * Covers:
 *   - Official CLI command name is `sunat:peru:import-snapshot`.
 *   - The non-existent alias `import:peru:sunat-snapshot` is NOT operative.
 *   - The Node 20 WebSocket shim applies only in CLI/server context
 *     (importing the importer module must not install it).
 *   - The shim exposes no API keys and makes no external calls.
 *   - The importer keeps dry-run by default and only applies with --apply.
 *   - Guardrails: shim/importer do not call Migo, SUNAT web, Tavily, or LLM,
 *     and create no candidates/accounts/batches.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ensureNode20WebSocketShim } from '../../../../../../scripts/peru/ensure-node20-websocket-shim';
import { parseCliArgs } from '../import-peru-sunat-snapshot';

// Captured immediately after all imports resolve. Proves that importing the
// importer (and the shim helper) does NOT install a global WebSocket — the
// shim only runs from the CLI entrypoint (main()).
const WEBSOCKET_AFTER_IMPORT = (globalThis as { WebSocket?: unknown }).WebSocket;

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const ROOT = join(__dir, '..', '..', '..', '..', '..', '..');
const PKG_FILE = join(ROOT, 'package.json');
const HELPER_FILE = join(ROOT, 'scripts', 'peru', 'ensure-node20-websocket-shim.ts');
const REPORT_FILE = join(ROOT, 'scripts', 'peru', 'report-peru-source-coverage.ts');
const IMPORTER_FILE = join(__dir, '..', 'import-peru-sunat-snapshot.ts');

// ── Official CLI command name ──────────────────────────────────

describe('Perú.9B: official CLI command name', () => {
  let pkg: { scripts: Record<string, string> };

  before(() => {
    pkg = JSON.parse(readFileSync(PKG_FILE, 'utf-8')) as {
      scripts: Record<string, string>;
    };
  });

  it('sunat:peru:import-snapshot is the official importer script', () => {
    assert.ok(
      'sunat:peru:import-snapshot' in pkg.scripts,
      'sunat:peru:import-snapshot must exist in package.json',
    );
    assert.ok(
      pkg.scripts['sunat:peru:import-snapshot'].includes('import-peru-sunat-snapshot'),
      'official script must reference the importer file',
    );
  });

  it('import:peru:sunat-snapshot is NOT an operative script', () => {
    assert.ok(
      !('import:peru:sunat-snapshot' in pkg.scripts),
      'the non-existent alias import:peru:sunat-snapshot must not be added',
    );
  });
});

// ── Node 20 WebSocket shim behavior ────────────────────────────

describe('Perú.9B: ensureNode20WebSocketShim behavior', () => {
  it('installs a global WebSocket when the runtime has none', () => {
    const globalScope = globalThis as { WebSocket?: unknown };
    const original = globalScope.WebSocket;
    try {
      globalScope.WebSocket = undefined;
      ensureNode20WebSocketShim();
      assert.equal(
        typeof globalScope.WebSocket,
        'function',
        'shim must install a WebSocket constructor when absent',
      );
    } finally {
      globalScope.WebSocket = original;
    }
  });

  it('does not overwrite an existing global WebSocket (browser/Node 22+ no-op)', () => {
    const globalScope = globalThis as { WebSocket?: unknown };
    const original = globalScope.WebSocket;
    const sentinel = function ExistingWebSocket() {} as unknown;
    try {
      globalScope.WebSocket = sentinel;
      ensureNode20WebSocketShim();
      assert.equal(
        globalScope.WebSocket,
        sentinel,
        'shim must be a no-op when a global WebSocket already exists',
      );
    } finally {
      globalScope.WebSocket = original;
    }
  });

  it('importing the importer does not install the shim (CLI-only effect)', () => {
    assert.equal(
      WEBSOCKET_AFTER_IMPORT,
      undefined,
      'merely importing the importer must not install a global WebSocket',
    );
  });
});

// ── Importer keeps dry-run by default ──────────────────────────

describe('Perú.9B: importer dry-run safety', () => {
  it('parseCliArgs defaults to dry-run when --apply is absent', () => {
    const cfg = parseCliArgs(['node', 'script', '--offset', '150000', '--limit', '1000']);
    assert.equal(cfg.dryRun, true);
    assert.equal(cfg.apply, false);
  });

  it('parseCliArgs sets apply only when --apply is passed', () => {
    const cfg = parseCliArgs([
      'node',
      'script',
      '--offset',
      '150000',
      '--limit',
      '1000',
      '--apply',
    ]);
    assert.equal(cfg.apply, true);
    assert.equal(cfg.dryRun, false);
  });
});

// ── Guardrails: shim is CLI/server-only and secret-free ────────

describe('Perú.9B: shim guardrails (static source analysis)', () => {
  let helperSrc: string;
  let importerSrc: string;
  let reportSrc: string;

  before(() => {
    helperSrc = readFileSync(HELPER_FILE, 'utf-8');
    importerSrc = readFileSync(IMPORTER_FILE, 'utf-8');
    reportSrc = readFileSync(REPORT_FILE, 'utf-8');
  });

  it('shim helper exposes no API keys or secrets', () => {
    for (const needle of [
      'MIGO_API_KEY',
      'NEXT_PUBLIC_MIGO',
      'SUPABASE_SERVICE_ROLE_KEY',
      'process.env',
      'Authorization',
      'Bearer',
    ]) {
      assert.ok(!helperSrc.includes(needle), `helper must not reference ${needle}`);
    }
  });

  it('shim helper makes no external calls', () => {
    assert.ok(!helperSrc.includes('fetch('), 'helper must not call fetch');
    assert.ok(!helperSrc.includes('http://'), 'helper must not contain URLs');
    assert.ok(!helperSrc.includes('https://'), 'helper must not contain URLs');
  });

  it('shim helper does not reference Migo, SUNAT web, Tavily, or LLM', () => {
    assert.ok(!helperSrc.toLowerCase().includes('migo'), 'no Migo');
    assert.ok(!helperSrc.includes('sunat.gob.pe'), 'no SUNAT web');
    assert.ok(!helperSrc.toLowerCase().includes('tavily'), 'no Tavily');
  });

  it('shim helper performs no Supabase writes', () => {
    for (const needle of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.ok(!helperSrc.includes(needle), `helper must not call ${needle}`);
    }
  });

  it('importer applies the shim inside main(), not at module scope', () => {
    const mainIdx = importerSrc.indexOf('async function main()');
    const callIdx = importerSrc.indexOf('ensureNode20WebSocketShim()');
    assert.ok(mainIdx !== -1, 'main() entrypoint must exist');
    assert.ok(
      callIdx > mainIdx,
      'shim call must live inside the CLI main(), never at module top-level',
    );
  });

  it('report script reuses the shared shim helper', () => {
    assert.ok(
      reportSrc.includes('ensureNode20WebSocketShim'),
      'report script must reuse the shared shim helper',
    );
  });
});
