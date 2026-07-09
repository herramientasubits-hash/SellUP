/**
 * Tests — EC SCVS Duplicate Profiler
 * Sin red, sin DB. Hito: Catálogo.EC.3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDuplicateGroup,
  profileDuplicateRucGroups,
  hashNormalizedRuc,
  classifyEcScvsRucAnomaly,
} from '../ec-scvs-duplicate-profiler';
import type { EcScvsNormalizedCandidate } from '../ec-scvs-types';

const RUC_A = '1790013731001';
const RUC_B = '0990013731001';

function candidate(overrides: Partial<EcScvsNormalizedCandidate> = {}): EcScvsNormalizedCandidate {
  return {
    sourceRowIndex: 0,
    expediente: '1',
    rawRuc: RUC_A,
    normalizedRuc: RUC_A,
    sourceReportedName: 'ACME SA',
    companyType: 'ANONIMA',
    provinceCode: '17',
    province: 'PICHINCHA',
    ...overrides,
  };
}

describe('classifyDuplicateGroup', () => {
  it('A — todas las filas idénticas en campos relevantes', () => {
    const group = [candidate({ sourceRowIndex: 0 }), candidate({ sourceRowIndex: 1 })];
    assert.equal(classifyDuplicateGroup(group), 'A_EXACT_DUPLICATE_ROWS');
  });

  it('B — mismo nombre/tipo/expediente, cambia provincia/pro_codigo', () => {
    const group = [
      candidate({ provinceCode: '17', province: 'PICHINCHA' }),
      candidate({ provinceCode: '9', province: 'GUAYAS' }),
    ];
    assert.equal(classifyDuplicateGroup(group), 'B_SAME_COMPANY_SAME_EXPEDIENT_LOCATION_VARIANT');
  });

  it('C — mismo nombre/tipo, distinto expediente', () => {
    const group = [candidate({ expediente: '1' }), candidate({ expediente: '2' })];
    assert.equal(classifyDuplicateGroup(group), 'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS');
  });

  it('D — mismo RUC, diferencias de nombre (resto igual)', () => {
    const group = [
      candidate({ sourceReportedName: 'ACME SA' }),
      candidate({ sourceReportedName: 'ACME S.A.' }),
    ];
    assert.equal(classifyDuplicateGroup(group), 'D_NAME_VARIANT_SAME_RUC');
  });

  it('E — mismo RUC, cambia tipo (resto igual)', () => {
    const group = [
      candidate({ companyType: 'ANONIMA' }),
      candidate({ companyType: 'LIMITADA' }),
    ];
    assert.equal(classifyDuplicateGroup(group), 'E_COMPANY_TYPE_VARIANT_SAME_RUC');
  });

  it('F — conflicto multi-campo (nombre y expediente cambian simultáneamente)', () => {
    const group = [
      candidate({ sourceReportedName: 'ACME SA', expediente: '1' }),
      candidate({ sourceReportedName: 'OTRA EMPRESA SA', expediente: '2' }),
    ];
    assert.equal(classifyDuplicateGroup(group), 'F_MULTI_FIELD_CONFLICT');
  });

  it('F — conflicto multi-campo (tipo y provincia cambian simultáneamente)', () => {
    const group = [
      candidate({ companyType: 'ANONIMA', provinceCode: '17', province: 'PICHINCHA' }),
      candidate({ companyType: 'LIMITADA', provinceCode: '9', province: 'GUAYAS' }),
    ];
    assert.equal(classifyDuplicateGroup(group), 'F_MULTI_FIELD_CONFLICT');
  });

  it('grupo de 3+ filas: clasifica A solo si TODAS son idénticas', () => {
    const group = [candidate(), candidate(), candidate({ expediente: '2' })];
    assert.equal(classifyDuplicateGroup(group), 'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS');
  });
});

describe('hashNormalizedRuc', () => {
  it('nunca contiene el RUC completo en el hash', () => {
    const hash = hashNormalizedRuc(RUC_A);
    assert.equal(hash.includes(RUC_A), false);
  });

  it('es determinístico para el mismo RUC', () => {
    assert.equal(hashNormalizedRuc(RUC_A), hashNormalizedRuc(RUC_A));
  });

  it('produce hashes distintos para RUC distintos', () => {
    assert.notEqual(hashNormalizedRuc(RUC_A), hashNormalizedRuc(RUC_B));
  });

  it('tiene longitud corta y segura (12 hex chars)', () => {
    assert.equal(hashNormalizedRuc(RUC_A).length, 12);
    assert.ok(/^[0-9a-f]{12}$/.test(hashNormalizedRuc(RUC_A)));
  });
});

describe('profileDuplicateRucGroups', () => {
  it('ignora RUC sin duplicados (grupo de 1 fila)', () => {
    const result = profileDuplicateRucGroups([candidate({ normalizedRuc: RUC_A })]);
    assert.equal(result.totalDuplicateGroups, 0);
    assert.equal(result.totalDuplicateRows, 0);
  });

  it('cuenta correctamente filas excedentes por grupo', () => {
    const result = profileDuplicateRucGroups([
      candidate({ normalizedRuc: RUC_A, expediente: '1' }),
      candidate({ normalizedRuc: RUC_A, expediente: '1' }),
      candidate({ normalizedRuc: RUC_A, expediente: '1' }),
    ]);
    assert.equal(result.totalDuplicateGroups, 1);
    assert.equal(result.totalDuplicateRows, 3);
    assert.equal(result.totalExcessRows, 2);
    assert.equal(result.maxGroupSize, 3);
    assert.equal(result.groupsWithThreeRows, 1);
  });

  it('clasifica por cardinalidad (2, 3, >3)', () => {
    const result = profileDuplicateRucGroups([
      candidate({ normalizedRuc: '1000000000001' }),
      candidate({ normalizedRuc: '1000000000001' }),
      candidate({ normalizedRuc: '2000000000001' }),
      candidate({ normalizedRuc: '2000000000001' }),
      candidate({ normalizedRuc: '2000000000001' }),
      candidate({ normalizedRuc: '3000000000001' }),
      candidate({ normalizedRuc: '3000000000001' }),
      candidate({ normalizedRuc: '3000000000001' }),
      candidate({ normalizedRuc: '3000000000001' }),
    ]);
    assert.equal(result.groupsWithTwoRows, 1);
    assert.equal(result.groupsWithThreeRows, 1);
    assert.equal(result.groupsWithMoreThanThreeRows, 1);
    assert.equal(result.maxGroupSize, 4);
  });

  it('el reporte agregado nunca expone el RUC completo (solo groupHash)', () => {
    const result = profileDuplicateRucGroups([
      candidate({ normalizedRuc: RUC_A }),
      candidate({ normalizedRuc: RUC_A }),
    ]);
    for (const g of result.groups) {
      assert.equal(g.groupHash.includes(RUC_A), false);
    }
  });

  it('agrega classSummary con groups/rows/excessRows por clase', () => {
    const result = profileDuplicateRucGroups([
      candidate({ normalizedRuc: RUC_A, expediente: '1' }),
      candidate({ normalizedRuc: RUC_A, expediente: '1' }),
    ]);
    const exactClass = result.classSummary.find((c) => c.duplicateClass === 'A_EXACT_DUPLICATE_ROWS');
    assert.ok(exactClass);
    assert.equal(exactClass?.groups, 1);
    assert.equal(exactClass?.rows, 2);
    assert.equal(exactClass?.excessRows, 1);
  });
});

describe('classifyEcScvsRucAnomaly', () => {
  it('A — recuperable eliminando puntuación permitida (produce exactamente 13 dígitos)', () => {
    assert.equal(classifyEcScvsRucAnomaly('179.001.373.1001'), 'A_PUNCTUATION_ONLY_RECOVERABLE');
  });

  it('B — contaminación alfabética (contiene letras)', () => {
    assert.equal(classifyEcScvsRucAnomaly('179001373100A'), 'B_ALPHABETIC_CONTAMINATION');
  });

  it('C — longitud inválida tras normalización (numérico puro, no 13 dígitos)', () => {
    assert.equal(classifyEcScvsRucAnomaly('179.001.373'), 'C_INVALID_LENGTH_AFTER_NORMALIZATION');
  });

  it('D — otro formato inválido (sin dígitos utilizables)', () => {
    assert.equal(classifyEcScvsRucAnomaly('---'), 'D_OTHER_INVALID_FORMAT');
  });

  it('NO aplica heurística O→0', () => {
    // "179OO13731001" contiene letras O — debe clasificarse B, nunca corregirse a 0
    assert.equal(classifyEcScvsRucAnomaly('179OO13731001'), 'B_ALPHABETIC_CONTAMINATION');
  });

  it('NO aplica heurística I→1', () => {
    assert.equal(classifyEcScvsRucAnomaly('179I013731001'), 'B_ALPHABETIC_CONTAMINATION');
  });
});
