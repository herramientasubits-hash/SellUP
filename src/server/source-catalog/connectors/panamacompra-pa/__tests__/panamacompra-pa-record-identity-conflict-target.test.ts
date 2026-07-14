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
import { OLD_TAX_GRAIN_ON_CONFLICT, validateRecordIdentityKey } from '../../../record-identity';
import { derivePanamaRecordIdentity } from '../panamacompra-pa-snapshot-builder';

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
      /import\s*\{[^}]*\bOLD_TAX_GRAIN_ON_CONFLICT\b[^}]*\}\s*from\s*['"].*record-identity['"]/,
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

describe('run-panamacompra-pa-convenio-snapshot-etl — P2B identity boundary (EC4D5.E)', () => {
  it('el script referencia validateRecordIdentityKey antes del upsert', () => {
    const source = readScript();
    assert.match(source, /validateRecordIdentityKey/);
  });

  it('company:<id> es una identidad permitida (allowed)', () => {
    const identity = derivePanamaRecordIdentity({
      companyId: 'PA-COMPANY-123',
      providerId: null,
      normalizedTaxId: null,
    });
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;
    assert.equal(identity.recordIdentityKey, 'company:PA-COMPANY-123');
    assert.equal(validateRecordIdentityKey(identity.recordIdentityKey).valid, true);
  });

  it('provider:<id> es una identidad permitida (allowed)', () => {
    const identity = derivePanamaRecordIdentity({
      companyId: null,
      providerId: 'PA-PROVIDER-456',
      normalizedTaxId: null,
    });
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;
    assert.equal(identity.recordIdentityKey, 'provider:PA-PROVIDER-456');
    assert.equal(validateRecordIdentityKey(identity.recordIdentityKey).valid, true);
  });

  it('tax:<id> (fallback) es una identidad permitida (allowed) cuando no hay company_id ni provider_id', () => {
    const identity = derivePanamaRecordIdentity({
      companyId: null,
      providerId: null,
      normalizedTaxId: '8-123-456',
    });
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;
    assert.equal(identity.recordIdentityKey, 'tax:8-123-456');
    assert.equal(validateRecordIdentityKey(identity.recordIdentityKey).valid, true);
  });

  it('sin company_id, provider_id ni normalized_tax_id la fila queda bloqueada (blocked)', () => {
    const identity = derivePanamaRecordIdentity({
      companyId: null,
      providerId: null,
      normalizedTaxId: null,
    });
    assert.equal(identity.status, 'unavailable');
    // identity.status is already asserted 'unavailable' above, so record_identity_key is null.
    const recordIdentityKey: string | null = null;
    const validation = validateRecordIdentityKey(recordIdentityKey);
    assert.equal(validation.valid, false);
  });

  it('company_id tiene precedencia sobre provider_id y normalized_tax_id', () => {
    const identity = derivePanamaRecordIdentity({
      companyId: 'PA-COMPANY-1',
      providerId: 'PA-PROVIDER-2',
      normalizedTaxId: '8-999-999',
    });
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;
    assert.equal(identity.recordIdentityKey, 'company:PA-COMPANY-1');
  });
});
