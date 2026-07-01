/**
 * Tests unitarios — DGCP RD Normalizer + Snapshot Builder
 *
 * Sin red real. Cubre RNC, año, builder y guardrails semánticos.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeRnc,
  extractYearFromDate,
  normalizeContrato,
  resolveProviderRnc,
} from '../dgcp-rd-normalizer';
import {
  buildDgcpSnapshotRow,
  accumulateByRpeYear,
  DGCP_SOURCE_KEY,
  DGCP_COUNTRY_CODE,
} from '../dgcp-rd-snapshot-builder';
import type { DgcpProveedor, DgcpContrato } from '../dgcp-rd-client';
import type { ProviderAccumulator } from '../dgcp-rd-snapshot-builder';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const PROVEEDOR_FIXTURE: DgcpProveedor = {
  rpe: '131399',
  razon_social: 'Debell Store, EIRL',
  tipo_documento: 'RNC',
  numero_documento: '132164148',
  estado: 'Activo',
  tipo_persona: 'Jurídica',
  forma_juridica: 'EIRL',
  fecha_registro_rpe: '2020-01-15',
  es_mipyme: true,
  clasificacion: 'Micro empresa',
  pais: 'REPÚBLICA DOMINICANA',
  region: 'OZAMA O METROPOLITANA',
  provincia: 'SANTO DOMINGO',
  municipio: 'SANTO DOMINGO ESTE',
};

const CONTRATO_FIXTURE: DgcpContrato = {
  codigo_contrato: 'DFENS-2026-00084',
  codigo_proceso: 'DFENS-DAF-CM-2026-0019',
  estado_contrato: 'Activo',
  estado_adjudicacion: 'Confirmada y enviada',
  fecha_adjudicacion: '2026-06-26',
  divisa: 'DOP',
  valor_contratado: 73000,
  descripcion: 'Adquisición de equipos electrónicos',
  url_contrato: 'https://comunidad.comprasdominicana.gob.do/contract/1234',
  unidad_compra: 'Defensor del Pueblo',
  codigo_unidad_compra: '964',
  rpe: '131399',
  razon_social: 'Debell Store, EIRL',
};

// ─── normalizeRnc ──────────────────────────────────────────────────────────────

describe('normalizeRnc', () => {
  it('normaliza RNC de 9 dígitos', () => {
    const result = normalizeRnc('132164148');
    assert.ok(result.ok);
    assert.equal(result.ok && result.normalizedRnc, '132164148');
  });

  it('remueve guiones', () => {
    const result = normalizeRnc('1-32-16414-8');
    assert.ok(result.ok);
    assert.equal(result.ok && result.normalizedRnc, '132164148');
  });

  it('remueve puntos', () => {
    const result = normalizeRnc('132.164.148');
    assert.ok(result.ok);
    assert.equal(result.ok && result.normalizedRnc, '132164148');
  });

  it('rechaza cédula/persona física de 11 dígitos', () => {
    const result = normalizeRnc('00112345678');
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'non_juridical_identifier');
  });

  it('rechaza null', () => {
    const result = normalizeRnc(null);
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'missing_rnc');
  });

  it('rechaza string vacío', () => {
    const result = normalizeRnc('');
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'missing_rnc');
  });

  it('rechaza formato no numérico', () => {
    const result = normalizeRnc('RNC-1234');
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'invalid_format');
  });

  it('rechaza 8 dígitos (no es RNC válido)', () => {
    const result = normalizeRnc('12345678');
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'invalid_format');
  });
});

// ─── extractYearFromDate ───────────────────────────────────────────────────────

describe('extractYearFromDate', () => {
  it('extrae año de fecha ISO', () => {
    assert.equal(extractYearFromDate('2026-06-26'), 2026);
  });

  it('extrae año de fecha ISO con hora', () => {
    assert.equal(extractYearFromDate('2025-12-01T10:30:00'), 2025);
  });

  it('extrae año de DD/MM/YYYY', () => {
    assert.equal(extractYearFromDate('26/06/2026'), 2026);
  });

  it('retorna null para string vacío', () => {
    assert.equal(extractYearFromDate(''), null);
  });

  it('retorna null para null', () => {
    assert.equal(extractYearFromDate(null), null);
  });

  it('retorna null para formato no reconocido', () => {
    assert.equal(extractYearFromDate('junio 2026'), null);
  });
});

// ─── normalizeContrato ─────────────────────────────────────────────────────────

describe('normalizeContrato', () => {
  it('extrae rpe del contrato', () => {
    const n = normalizeContrato(CONTRATO_FIXTURE);
    assert.equal(n.rpe, '131399');
  });

  it('extrae año desde fecha_adjudicacion', () => {
    const n = normalizeContrato(CONTRATO_FIXTURE);
    assert.equal(n.award_year, 2026);
  });

  it('trunca descripcion a 280 chars', () => {
    const largo = 'A'.repeat(400);
    const n = normalizeContrato({ ...CONTRATO_FIXTURE, descripcion: largo });
    assert.ok((n.descripcion?.length ?? 0) <= 280);
  });
});

// ─── resolveProviderRnc ────────────────────────────────────────────────────────

describe('resolveProviderRnc', () => {
  it('resuelve RNC válido', () => {
    const result = resolveProviderRnc(PROVEEDOR_FIXTURE);
    assert.ok(result.ok);
    assert.equal(result.ok && result.normalizedRnc, '132164148');
  });

  it('rechaza tipo_documento no-RNC', () => {
    const p: DgcpProveedor = { ...PROVEEDOR_FIXTURE, tipo_documento: 'CEDULA' };
    const result = resolveProviderRnc(p);
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'not_rnc_type');
  });

  it('rechaza 11 dígitos (cédula) aunque tipo_documento diga RNC', () => {
    const p: DgcpProveedor = { ...PROVEEDOR_FIXTURE, numero_documento: '00112345678' };
    const result = resolveProviderRnc(p);
    assert.ok(!result.ok);
    assert.equal(!result.ok && result.reason, 'non_juridical_identifier');
  });
});

// ─── accumulateByRpeYear ───────────────────────────────────────────────────────

describe('accumulateByRpeYear', () => {
  it('agrupa contratos del mismo rpe/año', () => {
    const contratos = [
      { ...normalizeContrato(CONTRATO_FIXTURE), valor_contratado: 50000 },
      { ...normalizeContrato(CONTRATO_FIXTURE), valor_contratado: 30000 },
    ];
    const map = accumulateByRpeYear(contratos);
    assert.equal(map.size, 1);
    const acc = map.get('131399::2026');
    assert.ok(acc);
    assert.equal(acc?.contracts.length, 2);
    assert.equal(acc?.totalAmountDop, 80000);
  });

  it('descarta contratos sin rpe', () => {
    const contratos = [
      { ...normalizeContrato(CONTRATO_FIXTURE), rpe: null },
    ];
    const map = accumulateByRpeYear(contratos);
    assert.equal(map.size, 0);
  });

  it('descarta contratos sin award_year', () => {
    const contratos = [
      { ...normalizeContrato(CONTRATO_FIXTURE), award_year: null },
    ];
    const map = accumulateByRpeYear(contratos);
    assert.equal(map.size, 0);
  });
});

// ─── buildDgcpSnapshotRow ─────────────────────────────────────────────────────

describe('buildDgcpSnapshotRow', () => {
  const ACC: ProviderAccumulator = {
    rpe: '131399',
    sourceYear: 2026,
    contracts: [normalizeContrato(CONTRATO_FIXTURE)],
    totalAmountDop: 73000,
    lastAwardDate: '2026-06-26',
  };

  it('usa source_key do_dgcp', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.source_key, DGCP_SOURCE_KEY);
    assert.equal(row.source_key, 'do_dgcp');
  });

  it('usa country_code DO', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.country_code, DGCP_COUNTRY_CODE);
    assert.equal(row.country_code, 'DO');
  });

  it('usa source_type procurement_signal (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.source_type, 'procurement_signal');
  });

  it('setea legal_validation_status not_applicable (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  });

  it('setea tax_validation_status not_applicable (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  });

  it('setea official_ciiu_available false (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.official_ciiu_available, false);
  });

  it('setea ciiu_status unavailable_for_mvp (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.ciiu_status, 'unavailable_for_mvp');
  });

  it('agrega total_contracts_year', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.total_contracts_year, 1);
  });

  it('agrega total_awarded_amount_dop', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.total_awarded_amount_dop, 73000);
  });

  it('preserva sample_contracts', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.ok(Array.isArray(row.raw_data.sample_contracts));
    assert.equal(row.raw_data.sample_contracts.length, 1);
  });

  it('limita sample_contracts a 10', () => {
    const manyContracts = Array.from({ length: 25 }, () => normalizeContrato(CONTRATO_FIXTURE));
    const acc: ProviderAccumulator = { ...ACC, contracts: manyContracts };
    const row = buildDgcpSnapshotRow({ acc, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.ok(row.raw_data.sample_contracts.length <= 10);
  });

  it('setea human_review_required true (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.human_review_required, true);
  });

  it('setea priority_boost true (en raw_data)', () => {
    const row = buildDgcpSnapshotRow({ acc: ACC, proveedor: PROVEEDOR_FIXTURE, normalizedRnc: '132164148' });
    assert.equal(row.raw_data.priority_boost, true);
  });
});
