/**
 * SOURCES-AR-RNS-1 — filas de `ar_rns`. CUIT reales del Registro Nacional de
 * Sociedades (datos públicos); razones sociales sintéticas donde no importan.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  accumulateAward,
  buildArRnsSnapshotRow,
  isLegalEntityCuit,
  isSiproLegalEntity,
  normalizeArLegalName,
  normalizeCuit,
  percentileScores,
  readRnsPrincipalActivity,
} from '../ar-rns-snapshot-builder';
import { AR_RNS_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/ar-rns-macro-table';

const VALID_CUIT = '30500000127';

function rnsRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    cuit: VALID_CUIT,
    razon_social: 'SEGUROS SINTETICOS S.A.',
    tipo_societario: 'SOCIEDAD ANONIMA',
    dom_fiscal_provincia: 'CIUDAD AUTONOMA BUENOS AIRES',
    dom_fiscal_localidad: 'CAPITAL FEDERAL',
    actividad_codigo: ' 651220',
    actividad_descripcion: 'Servicios de seguros patrimoniales',
    actividad_orden: '1',
    actividad_estado: 'AC',
    ...overrides,
  };
}

describe('normalizeCuit', () => {
  it('acepta una CUIT válida con o sin guiones y espacios', () => {
    assert.equal(normalizeCuit('30500000127'), VALID_CUIT);
    assert.equal(normalizeCuit('30-50000012-7'), VALID_CUIT);
    assert.equal(normalizeCuit(' 30 500000127 '), VALID_CUIT);
  });

  it('rechaza dígito verificador incorrecto, largo incorrecto y basura', () => {
    assert.equal(normalizeCuit('30500000128'), null);
    assert.equal(normalizeCuit('3050000012'), null);
    assert.equal(normalizeCuit('305000001270'), null);
    assert.equal(normalizeCuit('abc'), null);
    assert.equal(normalizeCuit(''), null);
    assert.equal(normalizeCuit(null), null);
  });

  it('distingue personas jurídicas (30, 33, 34) de personas físicas', () => {
    assert.equal(isLegalEntityCuit('30500000127'), true);
    assert.equal(isLegalEntityCuit('33693450239'), true);
    assert.equal(isLegalEntityCuit('20333449588'), false);
    assert.equal(isLegalEntityCuit('27111111116'), false);
  });
});

describe('SIPRO', () => {
  it('descarta las personas físicas y conserva el resto', () => {
    assert.equal(isSiproLegalEntity('Persona Fisica'), false);
    assert.equal(isSiproLegalEntity('Persona Fisica Extranjero No Residente'), false);
    assert.equal(isSiproLegalEntity('Sociedad Anonima'), true);
    assert.equal(isSiproLegalEntity('Sociedad Responsabilidad Limitada'), true);
    assert.equal(isSiproLegalEntity(null), false);
  });
});

describe('accumulateAward', () => {
  it('suma pesos y dólares por separado y recuerda el último año', () => {
    let acc = accumulateAward(undefined, { amount: 100, currency: 'Peso Argentino', year: 2020 });
    acc = accumulateAward(acc, { amount: 50, currency: 'Peso Argentino', year: 2024 });
    acc = accumulateAward(acc, { amount: 7, currency: 'Dolar Estadounidense', year: 2022 });
    acc = accumulateAward(acc, { amount: 9, currency: 'Euro - European Monetary Union', year: 2023 });
    assert.deepEqual(acc, { awardsCount: 4, totalArs: 150, totalUsd: 7, lastAwardYear: 2024 });
  });

  it('ignora importes negativos, nulos o no numéricos sin perder la adjudicación', () => {
    let acc = accumulateAward(undefined, { amount: -5, currency: 'Peso Argentino', year: null });
    acc = accumulateAward(acc, { amount: Number.NaN, currency: 'Peso Argentino', year: null });
    assert.deepEqual(acc, { awardsCount: 2, totalArs: 0, totalUsd: 0, lastAwardYear: null });
  });

  it('no muta el acumulador anterior', () => {
    const before = accumulateAward(undefined, { amount: 1, currency: 'Peso Argentino', year: 2020 });
    const copy = { ...before };
    accumulateAward(before, { amount: 2, currency: 'Peso Argentino', year: 2021 });
    assert.deepEqual(before, copy);
  });
});

describe('readRnsPrincipalActivity', () => {
  it('lee la actividad principal ACTIVA con el código relleno a 6 dígitos', () => {
    const activity = readRnsPrincipalActivity(rnsRow());
    assert.ok(activity);
    assert.equal(activity.cuit, VALID_CUIT);
    assert.equal(activity.activityCode, '651220');
    assert.equal(activity.legalName, 'SEGUROS SINTETICOS S.A.');
    assert.equal(readRnsPrincipalActivity(rnsRow({ actividad_codigo: '11111' }))?.activityCode, '011111');
  });

  it('descarta secundarias, bajas, sin código, sin nombre y CUIT inválida', () => {
    assert.equal(readRnsPrincipalActivity(rnsRow({ actividad_orden: '2' })), null);
    assert.equal(readRnsPrincipalActivity(rnsRow({ actividad_estado: 'BD' })), null);
    assert.equal(readRnsPrincipalActivity(rnsRow({ actividad_codigo: '' })), null);
    assert.equal(readRnsPrincipalActivity(rnsRow({ razon_social: '  ' })), null);
    assert.equal(readRnsPrincipalActivity(rnsRow({ cuit: '30500000128' })), null);
  });
});

describe('buildArRnsSnapshotRow', () => {
  const activity = readRnsPrincipalActivity(rnsRow())!;
  const row = buildArRnsSnapshotRow({
    activity,
    procurement: { awardsCount: 3, totalArs: 1500, totalUsd: 20, lastAwardYear: 2025 },
    inSipro: true,
    priorityScore: 87.456,
    sourceYear: 2026,
    importedAt: '2026-09-30T00:00:00.000Z',
  });

  it('identifica la fila por CUIT dentro de ar_rns / AR', () => {
    assert.equal(row.source_key, 'ar_rns');
    assert.equal(row.country_code, 'AR');
    assert.equal(row.source_year, 2026);
    assert.equal(row.tax_id, VALID_CUIT);
    assert.equal(row.normalized_tax_id, VALID_CUIT);
    assert.ok(row.record_identity_key);
    assert.match(String(row.record_identity_key), new RegExp(VALID_CUIT));
  });

  it('guarda actividad, macro y trazabilidad en raw_data, y el importe en signals', () => {
    assert.equal(row.raw_data.actividad_codigo, '651220');
    assert.equal(row.raw_data.macro_industry_key, 'insurance_financial_services');
    assert.equal(row.raw_data.macro_table_version, AR_RNS_MACRO_TABLE_VERSION);
    assert.equal(row.raw_data.tax_identifier_type, 'CUIT');
    assert.equal(row.signals.total_awarded_ars, 1500);
    assert.equal(row.signals.awards_count, 3);
    assert.equal(row.signals.in_sipro, true);
    assert.equal(row.region, 'CIUDAD AUTONOMA BUENOS AIRES');
    assert.equal(row.city, 'CAPITAL FEDERAL');
    assert.equal(row.priority_score, 87.46);
  });

  it('una actividad sin macro aprobada queda con macro null (nunca inventada)', () => {
    const hotel = readRnsPrincipalActivity(rnsRow({ actividad_codigo: '551010' }))!;
    const built = buildArRnsSnapshotRow({
      activity: hotel,
      procurement: null,
      inSipro: false,
      priorityScore: 0,
      sourceYear: 2026,
      importedAt: '2026-09-30T00:00:00.000Z',
    });
    assert.equal(built.raw_data.macro_industry_key, null);
    assert.equal(built.signals.awards_count, 0);
  });

  it('acota priority_score a 0-100', () => {
    const build = (priorityScore: number) =>
      buildArRnsSnapshotRow({ activity, procurement: null, inSipro: false, priorityScore, sourceYear: 2026, importedAt: 'x' })
        .priority_score;
    assert.equal(build(-4), 0);
    assert.equal(build(250), 100);
  });
});

describe('utilidades', () => {
  it('normaliza el nombre legal para buscar por nombre', () => {
    assert.equal(normalizeArLegalName('  Cámara   Ñandú, S.A. '), 'CAMARA NANDU, S.A.');
  });

  it('percentil: el mayor importe es 100, el menor 0 y los empates comparten valor', () => {
    assert.deepEqual(percentileScores([]), []);
    assert.deepEqual(percentileScores([5]), [0]);
    assert.deepEqual(percentileScores([10, 0, 0, 5]), [100, 0, 0, (2 / 3) * 100]);
  });
});
