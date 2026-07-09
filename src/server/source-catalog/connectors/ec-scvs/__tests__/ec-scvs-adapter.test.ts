/**
 * Tests — EC SCVS Adapter
 * Sin red, sin DB. Hito: Catálogo.EC.3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptEcScvsRows } from '../ec-scvs-adapter';
import type { EcScvsRawRow } from '../ec-scvs-types';

function row(overrides: Partial<EcScvsRawRow> = {}): EcScvsRawRow {
  return {
    expediente: '1',
    ruc: '1790013731001',
    nombre: 'ACME SA',
    tipo: 'ANONIMA',
    pro_codigo: '17',
    provincia: 'PICHINCHA',
    ...overrides,
  };
}

describe('adaptEcScvsRows', () => {
  it('acepta una fila válida', () => {
    const result = adaptEcScvsRows([row()]);
    assert.equal(result.stats.totalSourceRows, 1);
    assert.equal(result.stats.acceptedPreDedupRows, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.normalizedRuc, '1790013731001');
  });

  it('excluye filas con RUC ausente', () => {
    const result = adaptEcScvsRows([row({ ruc: null })]);
    assert.equal(result.stats.missingRucRows, 1);
    assert.equal(result.stats.acceptedPreDedupRows, 0);
    assert.equal(result.candidates.length, 0);
  });

  it('separa filas con RUC en formato inválido', () => {
    const result = adaptEcScvsRows([row({ ruc: 'ABC123' })]);
    assert.equal(result.stats.invalidRucRows, 1);
    assert.equal(result.invalidCandidates.length, 1);
    assert.equal(result.candidates.length, 0);
  });

  it('sourceReportedName refleja el nombre reportado, sin validación legal', () => {
    const result = adaptEcScvsRows([row({ nombre: '  ACME   SA  ' })]);
    assert.equal(result.candidates[0]?.sourceReportedName, 'ACME SA');
  });

  it('preserva companyType (tipo) tal como viene, solo trim de espacios', () => {
    const result = adaptEcScvsRows([row({ tipo: 'ANÓNIMA                    ' })]);
    assert.equal(result.candidates[0]?.companyType, 'ANÓNIMA');
  });

  it('preserva province/provinceCode', () => {
    const result = adaptEcScvsRows([row({ pro_codigo: '23', provincia: 'SANTO DOMINGO' })]);
    assert.equal(result.candidates[0]?.provinceCode, '23');
    assert.equal(result.candidates[0]?.province, 'SANTO DOMINGO');
  });

  it('NO deduplica silenciosamente — filas con mismo RUC permanecen ambas en candidates', () => {
    const result = adaptEcScvsRows([
      row({ expediente: '1' }),
      row({ expediente: '2' }),
    ]);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.stats.acceptedPreDedupRows, 2);
    assert.equal(result.stats.distinctNormalizedRuc, 1);
  });

  it('cuenta duplicateRucGroups y duplicateRowsExcess correctamente', () => {
    const result = adaptEcScvsRows([
      row({ ruc: '1790013731001', expediente: '1' }),
      row({ ruc: '1790013731001', expediente: '2' }),
      row({ ruc: '1790013731001', expediente: '3' }),
      row({ ruc: '0990013731001', expediente: '4' }),
    ]);
    assert.equal(result.stats.distinctNormalizedRuc, 2);
    assert.equal(result.stats.duplicateRucGroups, 1);
    assert.equal(result.stats.duplicateRowsExcess, 2);
  });

  it('preserva sourceRowIndex y rawRuc para trazabilidad', () => {
    const result = adaptEcScvsRows([row({ ruc: ' 1790013731001 ' })]);
    assert.equal(result.candidates[0]?.sourceRowIndex, 0);
    assert.equal(result.candidates[0]?.rawRuc, ' 1790013731001 ');
  });
});
