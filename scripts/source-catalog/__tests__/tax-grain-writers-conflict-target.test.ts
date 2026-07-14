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
import {
  OLD_TAX_GRAIN_ON_CONFLICT,
  deriveTaxRecordIdentity,
  validateRecordIdentityKey,
} from '../../../src/server/source-catalog/record-identity';

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
      // Nota (APP-B P2B): el import ahora también trae validateRecordIdentityKey
      // en el mismo statement (ver describe de más abajo), por eso el regex
      // tolera nombres adicionales dentro de las llaves en vez de exigir un
      // import de un solo nombre.
      assert.match(
        source,
        /import\s*\{[^}]*\bOLD_TAX_GRAIN_ON_CONFLICT\b[^}]*\}\s*from\s*['"].*record-identity['"]/,
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

/**
 * Static conflict-target guard — EC4D5.APP-B P2B record identity boundary.
 *
 * These same three CLI entrypoints now partition rows into allowed vs blocked
 * using validateRecordIdentityKey before the upsert call, and only send
 * allowed rows. Since main() isn't an exported/injectable unit here either,
 * these guards are static-source assertions (mirroring the OLD_TAX_GRAIN
 * guard above) plus pure-function coverage of validateRecordIdentityKey
 * itself, which is the actual partition logic used at each upsert site.
 */
describe('DGCP RD bulk / DGCP RD snapshot / SICOP CR — record_identity_key boundary (APP-B P2B)', () => {
  for (const scriptName of SCRIPTS) {
    it(`${scriptName} importa y usa validateRecordIdentityKey`, () => {
      const source = readScript(scriptName);
      assert.match(
        source,
        /import\s*\{[^}]*validateRecordIdentityKey[^}]*\}\s*from\s*['"].*record-identity['"]/,
      );
      assert.match(source, /validateRecordIdentityKey\(/);
    });

    it(`${scriptName} no usa RECORD_IDENTITY_ON_CONFLICT`, () => {
      const source = readScript(scriptName);
      assert.doesNotMatch(source, /RECORD_IDENTITY_ON_CONFLICT/);
    });

    it(`${scriptName} sigue conservando OLD_TAX_GRAIN_ON_CONFLICT (el boundary no cambia el conflict target)`, () => {
      const source = readScript(scriptName);
      assert.match(source, /onConflict:\s*OLD_TAX_GRAIN_ON_CONFLICT/);
    });
  }

  it('una fila con record_identity_key resuelto (tax:<id>) pasa validateRecordIdentityKey', () => {
    const identity = deriveTaxRecordIdentity('130123456789');
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;

    const validation = validateRecordIdentityKey(identity.recordIdentityKey);
    assert.equal(validation.valid, true);
  });

  it('una fila con identidad no resuelta (record_identity_key null) falla validateRecordIdentityKey', () => {
    const identity = deriveTaxRecordIdentity(null);
    assert.equal(identity.status, 'unavailable');
    if (identity.status !== 'unavailable') return;
    assert.equal(identity.reason, 'missing_tax_id');

    const recordIdentityKey = null;
    const validation = validateRecordIdentityKey(recordIdentityKey);
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.equal(validation.reason, 'missing_value');
  });

  it('un record_identity_key vacío tras trim también falla validateRecordIdentityKey', () => {
    const validation = validateRecordIdentityKey('   ');
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.equal(validation.reason, 'missing_value');
  });
});
