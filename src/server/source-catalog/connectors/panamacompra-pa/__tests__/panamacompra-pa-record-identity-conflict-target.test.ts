/**
 * Static conflict-target guard — EC4D5.C3 native-record writer (PanamaCompra Convenio).
 *
 * run-panamacompra-pa-convenio-snapshot-etl.ts is a CLI entrypoint (main()
 * calls process.exit and does network/file I/O), so importing it directly in
 * a test triggers a live network call. Instead, this asserts the script
 * imports and uses the shared OLD_TAX_GRAIN_ON_CONFLICT constant instead of a
 * hardcoded duplicate literal, never uses RECORD_IDENTITY_ON_CONFLICT, and
 * that the legacy tax grain string itself is unchanged — together these prove
 * the conflict target used at runtime is exactly what it was before EC4D5.C3.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OLD_TAX_GRAIN_ON_CONFLICT } from '../../../record-identity';

function readScript(): string {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'source-catalog', 'run-panamacompra-pa-convenio-snapshot-etl.ts'),
    'utf8',
  );
}

describe('OLD_TAX_GRAIN_ON_CONFLICT — value unchanged', () => {
  it('sigue siendo el grain fiscal legado', () => {
    assert.equal(OLD_TAX_GRAIN_ON_CONFLICT, 'source_key,country_code,source_year,normalized_tax_id');
  });
});

describe('run-panamacompra-pa-convenio-snapshot-etl — onConflict via constante compartida', () => {
  it('importa OLD_TAX_GRAIN_ON_CONFLICT del módulo compartido', () => {
    const source = readScript();
    assert.match(
      source,
      /import\s*\{\s*OLD_TAX_GRAIN_ON_CONFLICT\s*\}\s*from\s*['"].*record-identity['"]/,
    );
  });

  it('usa OLD_TAX_GRAIN_ON_CONFLICT en el upsert (no un literal duplicado)', () => {
    const source = readScript();
    assert.match(source, /onConflict:\s*OLD_TAX_GRAIN_ON_CONFLICT/);
    assert.doesNotMatch(
      source,
      /onConflict:\s*['"]source_key,country_code,source_year,normalized_tax_id['"]/,
    );
  });

  it('no usa RECORD_IDENTITY_ON_CONFLICT', () => {
    const source = readScript();
    assert.doesNotMatch(source, /RECORD_IDENTITY_ON_CONFLICT/);
  });
});
