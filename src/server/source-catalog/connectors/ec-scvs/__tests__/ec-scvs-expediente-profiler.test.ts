/**
 * Tests — EC SCVS Expediente Profiler (Catálogo.EC.3B)
 * Sin red, sin DB. Puro.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeScvsExpedienteForProfiling,
  profileExpedienteGlobal,
  profileExpedienteRucCardinality,
  classifyExpedienteDuplicateGroup,
  profileDuplicateExpedienteGroups,
  crossReferenceRucExpedienteCollisions,
  hashExpedienteForProfiling,
} from '../ec-scvs-expediente-profiler';
import type { EcScvsRawRow, EcScvsNormalizedCandidate } from '../ec-scvs-types';

const RUC_A = '1790013731001';
const RUC_B = '0990013731001';
const RUC_C = '1791234567001';

function row(overrides: Partial<EcScvsRawRow> = {}): EcScvsRawRow {
  return {
    expediente: '12345',
    ruc: RUC_A,
    nombre: 'ACME SA',
    tipo: 'ANONIMA',
    pro_codigo: '17',
    provincia: 'PICHINCHA',
    ...overrides,
  };
}

function candidate(overrides: Partial<EcScvsNormalizedCandidate> = {}): EcScvsNormalizedCandidate {
  return {
    sourceRowIndex: 0,
    expediente: '12345',
    rawRuc: RUC_A,
    normalizedRuc: RUC_A,
    sourceReportedName: 'ACME SA',
    companyType: 'ANONIMA',
    provinceCode: '17',
    province: 'PICHINCHA',
    ...overrides,
  };
}

describe('normalizeScvsExpedienteForProfiling', () => {
  it('1. expediente numeric — clasifica isNumericOnly', () => {
    const result = normalizeScvsExpedienteForProfiling('12345');
    assert.equal(result.isNumericOnly, true);
    assert.equal(result.isUsable, true);
  });

  it('2. trim — recorta espacios sin alterar contenido', () => {
    const result = normalizeScvsExpedienteForProfiling('  12345  ');
    assert.equal(result.trimmed, '12345');
  });

  it('3. empty — string vacío tras trim marca isUsable=false', () => {
    const result = normalizeScvsExpedienteForProfiling('   ');
    assert.equal(result.trimmed, '');
    assert.equal(result.isUsable, false);
  });

  it('4. leading zero preserved — nunca se elimina el cero inicial', () => {
    const result = normalizeScvsExpedienteForProfiling('000123');
    assert.equal(result.trimmed, '000123');
    assert.equal(result.hasLeadingZero, true);
  });

  it('null expediente produce isUsable=false y trimmed=null', () => {
    const result = normalizeScvsExpedienteForProfiling(null);
    assert.equal(result.isUsable, false);
    assert.equal(result.trimmed, null);
  });
});

describe('profileExpedienteGlobal', () => {
  it('5. raw vs trimmed distinct — colapsa variantes con espacios', () => {
    const rows = [row({ expediente: '123' }), row({ expediente: ' 123 ' })];
    const profile = profileExpedienteGlobal(rows);
    assert.equal(profile.distinctRawCount, 2);
    assert.equal(profile.distinctTrimmedCount, 1);
    assert.equal(profile.duplicateTrimmedGroups, 1);
    assert.equal(profile.duplicateRowsExcess, 1);
  });

  it('cuenta null y empty-after-trim por separado', () => {
    const rows = [row({ expediente: null }), row({ expediente: '   ' }), row({ expediente: '1' })];
    const profile = profileExpedienteGlobal(rows);
    assert.equal(profile.nullCount, 1);
    assert.equal(profile.nonNullCount, 2);
    assert.equal(profile.emptyAfterTrimCount, 1);
  });

  it('computa min/max length y distribución', () => {
    const rows = [row({ expediente: '1' }), row({ expediente: '123' })];
    const profile = profileExpedienteGlobal(rows);
    assert.equal(profile.minLength, 1);
    assert.equal(profile.maxLength, 3);
    assert.equal(profile.lengthDistribution.length, 2);
  });
});

describe('profileExpedienteRucCardinality', () => {
  it('6. one expediente one RUC — clasifica A_ONE_TO_ONE', () => {
    const rows = [row({ expediente: 'E1', ruc: RUC_A }), row({ expediente: 'E2', ruc: RUC_B })];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.expedientesWithExactlyOneRuc, 2);
    assert.equal(profile.rucWithExactlyOneExpediente, 2);
    assert.equal(profile.relationshipClass, 'A_ONE_TO_ONE');
  });

  it('7. one RUC many expedientes — clasifica B', () => {
    const rows = [
      row({ expediente: 'E1', ruc: RUC_A }),
      row({ expediente: 'E2', ruc: RUC_A }),
    ];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.rucWithMoreThanOneExpediente, 1);
    assert.equal(profile.maxExpedientesPerRuc, 2);
    assert.equal(profile.relationshipClass, 'B_ONE_RUC_TO_MANY_EXPEDIENTES');
  });

  it('8. one expediente many RUC — clasifica C', () => {
    const rows = [
      row({ expediente: 'E1', ruc: RUC_A }),
      row({ expediente: 'E1', ruc: RUC_B }),
    ];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.expedientesWithMoreThanOneRuc, 1);
    assert.equal(profile.maxDistinctRucPerExpediente, 2);
    assert.equal(profile.relationshipClass, 'C_ONE_EXPEDIENTE_TO_MANY_RUCS');
  });

  it('9. many-to-many classification — clasifica D', () => {
    const rows = [
      row({ expediente: 'E1', ruc: RUC_A }),
      row({ expediente: 'E1', ruc: RUC_B }),
      row({ expediente: 'E2', ruc: RUC_A }),
    ];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.relationshipClass, 'D_MANY_TO_MANY');
  });

  it('16. cardinality max — reporta máximos correctos', () => {
    const rows = [
      row({ expediente: 'E1', ruc: RUC_A }),
      row({ expediente: 'E1', ruc: RUC_B }),
      row({ expediente: 'E1', ruc: RUC_C }),
    ];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.maxDistinctRucPerExpediente, 3);
  });

  it('expediente sin ruc válido cuenta en expedientesWithZeroValidRuc', () => {
    const rows = [row({ expediente: 'E1', ruc: null })];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.expedientesWithZeroValidRuc, 1);
  });

  it('rows sin expediente usable no participan en la cardinalidad', () => {
    const rows = [row({ expediente: null, ruc: RUC_A })];
    const profile = profileExpedienteRucCardinality(rows);
    assert.equal(profile.rowsWithoutUsableExpediente, 1);
    assert.equal(profile.rowsWithoutUsableExpedienteButValidRuc, 1);
    assert.equal(profile.usableExpedienteRows, 0);
  });
});

describe('classifyExpedienteDuplicateGroup', () => {
  it('10. X1 exact duplicate — todos los campos iguales', () => {
    const rows = [row(), row()];
    assert.equal(classifyExpedienteDuplicateGroup(rows), 'X1_EXACT_DUPLICATE_ROWS');
  });

  it('11. X2 location variant — cambia ubicación', () => {
    const rows = [row({ pro_codigo: '17', provincia: 'PICHINCHA' }), row({ pro_codigo: '9', provincia: 'GUAYAS' })];
    assert.equal(classifyExpedienteDuplicateGroup(rows), 'X2_SAME_IDENTITY_LOCATION_VARIANT');
  });

  it('12. X3 RUC variant — cambia RUC, mismo nombre/tipo', () => {
    const rows = [row({ ruc: RUC_A }), row({ ruc: RUC_B })];
    assert.equal(classifyExpedienteDuplicateGroup(rows), 'X3_SAME_EXPEDIENTE_RUC_VARIANT');
  });

  it('13. X4 name variant — cambia nombre, mismo RUC/tipo', () => {
    const rows = [row({ nombre: 'ACME SA' }), row({ nombre: 'ACME S.A.' })];
    assert.equal(classifyExpedienteDuplicateGroup(rows), 'X4_SAME_EXPEDIENTE_NAME_VARIANT');
  });

  it('14. X5 type variant — cambia tipo, mismo RUC/nombre', () => {
    const rows = [row({ tipo: 'ANONIMA' }), row({ tipo: 'LIMITADA' })];
    assert.equal(classifyExpedienteDuplicateGroup(rows), 'X5_SAME_EXPEDIENTE_TYPE_VARIANT');
  });

  it('15. X6 multi-field conflict — cambian múltiples campos', () => {
    const rows = [
      row({ nombre: 'ACME SA', ruc: RUC_A }),
      row({ nombre: 'OTRA SA', ruc: RUC_B }),
    ];
    assert.equal(classifyExpedienteDuplicateGroup(rows), 'X6_MULTI_FIELD_CONFLICT');
  });
});

describe('profileDuplicateExpedienteGroups', () => {
  it('17. duplicate rows excess — cuenta filas excedentes por grupo', () => {
    const rows = [
      row({ expediente: 'E1' }),
      row({ expediente: 'E1' }),
      row({ expediente: 'E1' }),
      row({ expediente: 'E2' }),
    ];
    const result = profileDuplicateExpedienteGroups(rows);
    assert.equal(result.totalDuplicateGroups, 1);
    assert.equal(result.totalDuplicateRows, 3);
    assert.equal(result.totalExcessRows, 2);
    assert.equal(result.maxGroupSize, 3);
  });

  it('ignora expediente sin duplicados y sin expediente usable', () => {
    const rows = [row({ expediente: 'E1' }), row({ expediente: null })];
    const result = profileDuplicateExpedienteGroups(rows);
    assert.equal(result.totalDuplicateGroups, 0);
  });

  it('20. safe hash does not expose expediente crudo', () => {
    const rows = [row({ expediente: 'SENSITIVE-EXP-VALUE' }), row({ expediente: 'SENSITIVE-EXP-VALUE' })];
    const result = profileDuplicateExpedienteGroups(rows);
    for (const g of result.groups) {
      assert.equal(g.groupHash.includes('SENSITIVE-EXP-VALUE'), false);
    }
    const hash = hashExpedienteForProfiling('SENSITIVE-EXP-VALUE');
    assert.equal(hash.length, 12);
    assert.ok(/^[0-9a-f]{12}$/.test(hash));
  });
});

describe('crossReferenceRucExpedienteCollisions', () => {
  it('18. duplicate-RUC collision resolved by expediente — clase C con expediente distinto', () => {
    const candidates = [
      candidate({ normalizedRuc: RUC_A, expediente: 'E1' }),
      candidate({ normalizedRuc: RUC_A, expediente: 'E2' }),
    ];
    const result = crossReferenceRucExpedienteCollisions(candidates);
    assert.equal(result.classC.groups, 1);
    assert.equal(result.classC.groupsWithAllDistinctExpediente, 1);
    assert.equal(result.resolvesRucCollisions, true);
  });

  it('19. unresolved collision detection — mismo expediente dentro del mismo grupo RUC', () => {
    // sourceReportedName y companyType difieren simultáneamente (clase F legacy),
    // pero el expediente permanece igual en ambas filas → colisión NO resuelta.
    const candidates = [
      candidate({ normalizedRuc: RUC_A, expediente: 'E1', sourceReportedName: 'A', companyType: 'ANONIMA' }),
      candidate({ normalizedRuc: RUC_A, expediente: 'E1', sourceReportedName: 'B', companyType: 'LIMITADA' }),
    ];
    const result = crossReferenceRucExpedienteCollisions(candidates);
    assert.equal(result.totalUnresolvedGroups > 0, true);
    assert.equal(result.resolvesRucCollisions, false);
  });

  it('detecta expediente reutilizado en otro RUC (clase F)', () => {
    const candidates = [
      candidate({ normalizedRuc: RUC_A, expediente: 'E1', sourceReportedName: 'A', companyType: 'ANONIMA' }),
      candidate({ normalizedRuc: RUC_A, expediente: 'E2', sourceReportedName: 'B', companyType: 'LIMITADA' }),
      candidate({ normalizedRuc: RUC_B, expediente: 'E1', sourceReportedName: 'C', companyType: 'ANONIMA' }),
      candidate({ normalizedRuc: RUC_B, expediente: 'E3', sourceReportedName: 'D', companyType: 'LIMITADA' }),
    ];
    const result = crossReferenceRucExpedienteCollisions(candidates);
    assert.equal(result.classF.expedienteReusedElsewhereCount > 0, true);
  });
});
