/**
 * Static conflict-target guard — EC4D5.C2 remaining tax-grain writers.
 *
 * These ETL scripts are CLI entrypoints (main() calls process.exit and does
 * network/file I/O), so their onConflict literal isn't reachable through an
 * exported, injectable unit. Instead, this asserts the scripts import and
 * use the shared OLD_TAX_GRAIN_ON_CONFLICT constant instead of a hardcoded
 * duplicate literal, and that the legacy tax grain string itself is
 * unchanged — the two facts together prove the conflict target used at
 * runtime is exactly what it was before EC4D5.C2.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OLD_TAX_GRAIN_ON_CONFLICT } from '../../../src/server/source-catalog/record-identity';

const SCRIPTS = [
  'run-dgcp-rd-bulk-etl.ts',
  'run-dgcp-rd-snapshot-etl.ts',
  'run-sicop-cr-snapshot-etl.ts',
] as const;

function readScript(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

describe('OLD_TAX_GRAIN_ON_CONFLICT — value unchanged', () => {
  it('sigue siendo el grain fiscal legado', () => {
    assert.equal(OLD_TAX_GRAIN_ON_CONFLICT, 'source_key,country_code,source_year,normalized_tax_id');
  });
});

describe('DGCP RD bulk / DGCP RD snapshot / SICOP CR — onConflict via constante compartida', () => {
  for (const scriptName of SCRIPTS) {
    it(`${scriptName} importa OLD_TAX_GRAIN_ON_CONFLICT del módulo compartido`, () => {
      const source = readScript(scriptName);
      assert.match(
        source,
        /import\s*\{\s*OLD_TAX_GRAIN_ON_CONFLICT\s*\}\s*from\s*['"].*record-identity['"]/,
      );
    });

    it(`${scriptName} usa OLD_TAX_GRAIN_ON_CONFLICT en el upsert (no un literal duplicado)`, () => {
      const source = readScript(scriptName);
      assert.match(source, /onConflict:\s*OLD_TAX_GRAIN_ON_CONFLICT/);
      assert.doesNotMatch(
        source,
        /onConflict:\s*['"]source_key,country_code,source_year,normalized_tax_id['"]/,
      );
    });
  }
});
