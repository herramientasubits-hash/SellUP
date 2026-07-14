/**
 * Tests — PanamaCompra PA Snapshot Builder
 * Hito: Centroamérica.5B
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deduplicationKey,
  deduplicateProviderEntries,
  buildPanamaSnapshotRow,
  buildPanamaSnapshotRows,
  derivePanamaRecordIdentity,
  PANAMACOMPRA_SOURCE_KEY,
  PANAMACOMPRA_COUNTRY_CODE,
} from '../panamacompra-pa-snapshot-builder';
import type { PanaNormalizedProvider } from '../panamacompra-pa-normalizer';
import type { PanamaProviderEntry } from '../panamacompra-pa-snapshot-builder';

function makeProvider(overrides: Partial<PanaNormalizedProvider> = {}): PanaNormalizedProvider {
  return {
    providerId: '10',
    companyId: '20',
    rucOriginal: '8-100-200',
    normalizedTaxId: '8-100-200',
    rucStatus: 'present',
    legalName: 'EMPRESA TEST SA',
    address: 'Ciudad de Panamá',
    representativeName: 'Ana García',
    phone: '507-555-0000',
    email: 'test@test.com',
    branches: [],
    ...overrides,
  };
}

function makeEntry(provider: PanaNormalizedProvider, convenioIds: number[] = [1]): PanamaProviderEntry {
  return {
    provider,
    conveniosParticipados: convenioIds.map((id) => ({ id, nombre: `Convenio ${id}` })),
  };
}

describe('deduplicationKey', () => {
  it('usa companyId como clave principal', () => {
    const p = makeProvider({ companyId: '77' });
    assert.equal(deduplicationKey(p), 'company:77');
  });

  it('usa providerId si no hay companyId', () => {
    const p = makeProvider({ companyId: null, providerId: '55' });
    assert.equal(deduplicationKey(p), 'provider:55');
  });

  it('usa normalizedTaxId si no hay company ni provider Id', () => {
    const p = makeProvider({ companyId: null, providerId: null, normalizedTaxId: '8-100-200' });
    assert.equal(deduplicationKey(p), 'ruc:8-100-200');
  });

  it('usa name como fallback final', () => {
    const p = makeProvider({ companyId: null, providerId: null, normalizedTaxId: null, legalName: 'EMPRESA XYZ' });
    assert.equal(deduplicationKey(p), 'name:empresa xyz');
  });
});

describe('deduplicateProviderEntries — Caso 17', () => {
  it('deduplica dos entradas del mismo proveedor (mismo companyId)', () => {
    const p = makeProvider();
    const entries = [makeEntry(p, [1]), makeEntry(p, [2])];
    const result = deduplicateProviderEntries(entries);

    assert.equal(result.length, 1);
  });

  // Caso 18: agrupa convenios de duplicados
  it('agrupa convenios participados de proveedores duplicados', () => {
    const p = makeProvider();
    const entries = [makeEntry(p, [1, 2]), makeEntry(p, [3])];
    const result = deduplicateProviderEntries(entries);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.conveniosParticipados.length, 3);
  });

  it('no duplica convenios ya acumulados', () => {
    const p = makeProvider();
    const entries = [makeEntry(p, [1]), makeEntry(p, [1])];
    const result = deduplicateProviderEntries(entries);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.conveniosParticipados.length, 1);
  });

  it('mantiene proveedores distintos por companyId diferente', () => {
    const p1 = makeProvider({ companyId: '10' });
    const p2 = makeProvider({ companyId: '20' });
    const entries = [makeEntry(p1, [1]), makeEntry(p2, [2])];
    const result = deduplicateProviderEntries(entries);

    assert.equal(result.length, 2);
  });
});

describe('buildPanamaSnapshotRow — Caso 19', () => {
  it('construye snapshot con source_type = procurement_signal', () => {
    const entry = makeEntry(makeProvider());
    const row = buildPanamaSnapshotRow(entry);

    assert.equal(row.raw_data.source_type, 'procurement_signal');
  });

  it('source_key = pa_panamacompra_convenio', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.equal(row.source_key, PANAMACOMPRA_SOURCE_KEY);
    assert.equal(row.source_key, 'pa_panamacompra_convenio');
  });

  it('country_code = PA', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.equal(row.country_code, PANAMACOMPRA_COUNTRY_CODE);
    assert.equal(row.country_code, 'PA');
  });

  it('coverage_scope = convenio_marco', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.equal(row.raw_data.coverage_scope, 'convenio_marco');
  });

  it('legal_validation_status = not_applicable', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  });

  it('tax_validation_status = not_applicable', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  });

  it('human_review_required = true', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.ok(row.raw_data.human_review_required === true);
  });

  it('preserva tax_id y normalized_tax_id del proveedor', () => {
    const p = makeProvider({ rucOriginal: '8-100-200', normalizedTaxId: '8-100-200' });
    const row = buildPanamaSnapshotRow(makeEntry(p));

    assert.equal(row.tax_id, '8-100-200');
    assert.equal(row.normalized_tax_id, '8-100-200');
  });

  it('raw_data.convenios incluye los convenios participados', () => {
    const entry = makeEntry(makeProvider(), [5, 9]);
    const row = buildPanamaSnapshotRow(entry);

    assert.equal(row.raw_data.convenios.length, 2);
    assert.ok(row.raw_data.convenios.some((c) => c.id === 5));
  });

  it('status = active_or_listed', () => {
    const row = buildPanamaSnapshotRow(makeEntry(makeProvider()));
    assert.equal(row.status, 'active_or_listed');
  });
});

describe('buildPanamaSnapshotRows — Caso 20: no escribe DB', () => {
  it('buildPanamaSnapshotRows es función pura — no llama Supabase', () => {
    const entries = [makeEntry(makeProvider()), makeEntry(makeProvider({ companyId: '99' }))];
    const rows = buildPanamaSnapshotRows(entries);

    // Solo verificamos que devuelve el array esperado — no hay IO
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.source_key === 'pa_panamacompra_convenio'));
  });

  it('buildPanamaSnapshotRows devuelve array vacío para entradas vacías', () => {
    const rows = buildPanamaSnapshotRows([]);
    assert.deepEqual(rows, []);
  });
});

// ─── derivePanamaRecordIdentity — EC4D5.C3 shadow dual-write ─────────────────

describe('derivePanamaRecordIdentity', () => {
  it('company_id gana sobre provider_id y normalized_tax_id', () => {
    const result = derivePanamaRecordIdentity({
      companyId: 'E456',
      providerId: 'P123',
      normalizedTaxId: '8-100-200',
    });
    assert.deepEqual(result, { status: 'resolved', recordIdentityKey: 'company:E456' });
  });

  it('provider_id gana cuando no hay company_id', () => {
    const result = derivePanamaRecordIdentity({
      companyId: null,
      providerId: 'P123',
      normalizedTaxId: '8-100-200',
    });
    assert.deepEqual(result, { status: 'resolved', recordIdentityKey: 'provider:P123' });
  });

  it('cae a tax cuando no hay company_id ni provider_id', () => {
    const result = derivePanamaRecordIdentity({
      companyId: null,
      providerId: null,
      normalizedTaxId: '8-100-200',
    });
    assert.deepEqual(result, { status: 'resolved', recordIdentityKey: 'tax:8-100-200' });
  });

  it('unavailable cuando no hay ningún identificador — no excluye la fila', () => {
    const result = derivePanamaRecordIdentity({
      companyId: null,
      providerId: null,
      normalizedTaxId: null,
    });
    assert.equal(result.status, 'unavailable');

    // La fila sigue construyéndose normalmente (P2A no bloquea, no excluye).
    const row = buildPanamaSnapshotRow(
      makeEntry(makeProvider({ companyId: null, providerId: null, normalizedTaxId: null })),
    );
    assert.ok(row);
    assert.equal(row.source_key, 'pa_panamacompra_convenio');
  });

  it('nunca deriva de nombre/razón social', () => {
    const result = derivePanamaRecordIdentity({
      companyId: null,
      providerId: null,
      normalizedTaxId: null,
    });
    assert.notEqual(result.status, 'resolved');
    if (result.status === 'unavailable') {
      assert.notEqual(result.reason, 'forbidden_namespace' as string);
    }
  });
});
