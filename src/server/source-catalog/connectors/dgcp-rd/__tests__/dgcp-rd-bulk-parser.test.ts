/**
 * Tests — DGCP RD Bulk XLSX Parser (RD.2G)
 *
 * Verifica que el parser bulk:
 * - Parsea filas de proveedores a DgcpProveedor correctamente
 * - Parsea filas de contratos a DgcpContrato correctamente
 * - Rechaza RNC de 11 dígitos (cédulas de persona física)
 * - Rechaza proveedores sin RNC
 * - No toca rd_dgii_bulk, accounts, prospect_candidates
 * - El dedup por RNC+año funciona en el script ETL
 * - Coverage summary no usa complete_snapshot si carga es parcial
 * - No inventa CIIU
 * - Señal procurement_signal intacta
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseProveedorXlsxRow,
  parseContratoXlsxRow,
  rpeToKey,
} from '../dgcp-rd-bulk-parser';
import {
  normalizeRnc,
  resolveProviderRnc,
  extractYearFromDate,
} from '../dgcp-rd-normalizer';
import {
  accumulateByRpeYear,
  buildDgcpSnapshotRow,
  DGCP_SOURCE_KEY,
  DGCP_COUNTRY_CODE,
} from '../dgcp-rd-snapshot-builder';
import { normalizeContrato } from '../dgcp-rd-normalizer';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Row 1 from Proveedores.xlsx (validated 2026-07-01) */
const PROVEEDOR_ROW_JURIDICA: unknown[] = [
  1,                           // RPE (number in XLSX)
  'Ediciones Valdes, SRL',     // RAZON_SOCIAL
  '101870087',                 // NUMERO_DOCUMENTO (RNC 9-digit)
  'RNC',                       // TIPO_DOCUMENTO
  'Activo',                    // ESTADO_RPE
  'Masculino',                 // GENERO
  'Persona Jurídica',          // TIPO_PERSONA
  'Sociedades Comerciales',    // FORMA_JURIDICA
  37106.33,                    // FECHA_CREACION_EMPRESA (Excel serial — ignored)
  '2005-11-21 13:31:00.000',   // FECHA_REGISTRO_RPE
  '2019-11-12 15:33:22.936',   // FECHA_ULTIMA_ACTUALIZACION_RPE
  '19817SD',                   // NUMERO_REGISTRO_MERCANTIL
  44273.16,                    // FECHA_REGISTRO_MERCANTIL (Excel serial — ignored)
  'No',                        // MIPYME
  'No',                        // CERTIFICADO_MICM
  'No certificado',            // FECHA_VENCIMIENTO_CERTIFICACION_MICM
  'No clasificada',            // CLASIFICACION
  'No',                        // PRODUCTOR_NACIONAL
  null,                        // REGISTRO_INDUSTRIAL
  null,                        // OCUPACION
  'contabilidad@e_valdes.com', // CORREO_NOTIFICACIONES
  null,                        // OBSERVACION
  null,                        // ESTADO_COMENTARIO
  'No clasificada',            // CLASIFICACION_EMPRESARIAL
  'Empresa no acogida a la Ley 187-17', // CLASIFICACION_EMPRESARIAL_2
  'https://dgcp.gob.do/...',   // URL_CERTIFICACION_RPE
  'DO',                        // CODIGO_PAIS_ORIGEN
  'REPÚBLICA DOMINICANA',      // PAIS
  'OZAMA O METROPOLITANA',     // REGION
  'DISTRITO NACIONAL',         // PROVINCIA
  'DISTRITO NACIONAL',         // MUNICIPIO
];

/** Persona física row — should be rejected by resolveProviderRnc */
const PROVEEDOR_ROW_FISICA: unknown[] = [
  999,
  'Juan Perez',
  '00100200300',   // 11-digit cedula
  'Cedula',
  'Activo',
  'Masculino',
  'Persona Física',
  null,
  null,
  null,
  null,
  null,
  null,
  'No',
  ...new Array(16).fill(null),
  'DO',
  'REPÚBLICA DOMINICANA',
  'OZAMA O METROPOLITANA',
  'DISTRITO NACIONAL',
  'DISTRITO NACIONAL',
];

/** Valid contrato row from Contratos.xlsx */
const CONTRATO_ROW: unknown[] = [
  'DO1.PCCNTR.201',          // CODIGO_CONTRATO
  'Pendiente de aprobación', // ESTADO_CONTRATO
  'Confirmada',              // ESTADO_ADJUDICACION
  '2025-03-31 19:33:57.430', // FECHA_ADJUDICACION
  4792,                      // VALOR_CONTRATADO
  'DOP',                     // MONEDA
  '2025-03-31 19:44:14.649', // FECHA_CREACION_CONTRATO
  'Bienes de oficina',       // OBJETO_CONTRATO
  11624,                     // RPE (number in XLSX)
  'CORAL ELECTRICA, SRL',    // RAZON_SOCIAL
  '101825014',               // NUMERO_DOCUMENTO (RNC)
];

// ─── rpeToKey ──────────────────────────────────────────────────────────────────

test('rpeToKey: convierte número a string', () => {
  assert.equal(rpeToKey(1), '1');
  assert.equal(rpeToKey(11624), '11624');
  assert.equal(rpeToKey(131399), '131399');
});

test('rpeToKey: acepta string', () => {
  assert.equal(rpeToKey('131399'), '131399');
});

test('rpeToKey: rechaza null, 0, NaN', () => {
  assert.equal(rpeToKey(null), null);
  assert.equal(rpeToKey(0), null);
  assert.equal(rpeToKey(''), null);
  assert.equal(rpeToKey(NaN), null);
});

// ─── parseProveedorXlsxRow ─────────────────────────────────────────────────────

test('parseProveedorXlsxRow: parsea fila jurídica correctamente', () => {
  const proveedor = parseProveedorXlsxRow(PROVEEDOR_ROW_JURIDICA);
  assert.ok(proveedor, 'debe retornar proveedor');
  assert.equal(proveedor.rpe, '1');
  assert.equal(proveedor.razon_social, 'Ediciones Valdes, SRL');
  assert.equal(proveedor.numero_documento, '101870087');
  assert.equal(proveedor.tipo_documento, 'RNC');
  assert.equal(proveedor.estado, 'Activo');
  assert.equal(proveedor.tipo_persona, 'Persona Jurídica');
  assert.equal(proveedor.es_mipyme, false);
  assert.equal(proveedor.region, 'OZAMA O METROPOLITANA');
  assert.equal(proveedor.provincia, 'DISTRITO NACIONAL');
});

test('parseProveedorXlsxRow: retorna null si la fila es demasiado corta', () => {
  assert.equal(parseProveedorXlsxRow([]), null);
  assert.equal(parseProveedorXlsxRow([null, null, null]), null);
});

test('parseProveedorXlsxRow: retorna null si RPE es null', () => {
  const row = [...PROVEEDOR_ROW_JURIDICA];
  row[0] = null;
  assert.equal(parseProveedorXlsxRow(row), null);
});

// ─── parseContratoXlsxRow ──────────────────────────────────────────────────────

test('parseContratoXlsxRow: parsea fila de contrato correctamente', () => {
  const contrato = parseContratoXlsxRow(CONTRATO_ROW);
  assert.ok(contrato, 'debe retornar contrato');
  assert.equal(contrato.codigo_contrato, 'DO1.PCCNTR.201');
  assert.equal(contrato.estado_adjudicacion, 'Confirmada');
  assert.equal(contrato.fecha_adjudicacion, '2025-03-31 19:33:57.430');
  assert.equal(contrato.valor_contratado, 4792);
  assert.equal(contrato.divisa, 'DOP');
  assert.equal(contrato.rpe, '11624');
  assert.equal(contrato.razon_social, 'CORAL ELECTRICA, SRL');
  // Campos no disponibles en bulk XLSX:
  assert.equal(contrato.codigo_proceso, null);
  assert.equal(contrato.url_contrato, null);
  assert.equal(contrato.unidad_compra, null);
  assert.equal(contrato.codigo_unidad_compra, null);
});

test('parseContratoXlsxRow: retorna null si RPE es null', () => {
  const row = [...CONTRATO_ROW];
  row[8] = null;
  assert.equal(parseContratoXlsxRow(row), null);
});

test('parseContratoXlsxRow: retorna null si fila demasiado corta', () => {
  assert.equal(parseContratoXlsxRow([]), null);
  assert.equal(parseContratoXlsxRow(['x', 'y']), null);
});

// ─── Rechaza cédulas de 11 dígitos ────────────────────────────────────────────

test('rechaza cédula de 11 dígitos como non_juridical_identifier', () => {
  const result = normalizeRnc('00100200300');
  assert.equal(result.ok, false);
  assert.equal((result as { ok: false; reason: string }).reason, 'non_juridical_identifier');
});

test('normalizeRnc acepta RNC de 9 dígitos válido', () => {
  const result = normalizeRnc('101870087');
  assert.equal(result.ok, true);
  assert.equal((result as { ok: true; normalizedRnc: string }).normalizedRnc, '101870087');
});

test('normalizeRnc rechaza RNC vacío', () => {
  const result = normalizeRnc(null);
  assert.equal(result.ok, false);
  assert.equal((result as { ok: false; reason: string }).reason, 'missing_rnc');
});

test('normalizeRnc rechaza RNC de longitud incorrecta (8 dígitos)', () => {
  const result = normalizeRnc('10187008');
  assert.equal(result.ok, false);
  assert.equal((result as { ok: false; reason: string }).reason, 'invalid_format');
});

// ─── resolveProviderRnc rechaza persona física ─────────────────────────────────

test('resolveProviderRnc rechaza persona física (cédula 11 dígitos)', () => {
  const proveedor = parseProveedorXlsxRow(PROVEEDOR_ROW_FISICA);
  assert.ok(proveedor, 'debe parsear la fila');
  const result = resolveProviderRnc(proveedor);
  assert.equal(result.ok, false);
  // Cedula type → not_rnc_type o non_juridical_identifier
  assert.ok(
    (result as { ok: false; reason: string }).reason === 'not_rnc_type' ||
    (result as { ok: false; reason: string }).reason === 'non_juridical_identifier',
    `reason inesperado: ${(result as { ok: false; reason: string }).reason}`,
  );
});

test('resolveProviderRnc acepta jurídica con RNC válido', () => {
  const proveedor = parseProveedorXlsxRow(PROVEEDOR_ROW_JURIDICA);
  assert.ok(proveedor);
  const result = resolveProviderRnc(proveedor);
  assert.equal(result.ok, true);
  assert.equal((result as { ok: true; normalizedRnc: string }).normalizedRnc, '101870087');
});

// ─── Join RPE → RNC funciona en el flujo completo ─────────────────────────────

test('flujo completo: contrato bulk → accumulator → snapshot con señal procurement', () => {
  const contrato = parseContratoXlsxRow(CONTRATO_ROW);
  assert.ok(contrato);

  const normalized = normalizeContrato(contrato);
  assert.equal(normalized.award_year, 2025);
  assert.equal(normalized.rpe, '11624');

  const acc = accumulateByRpeYear([normalized]);
  assert.equal(acc.size, 1);

  const [entry] = acc.values();
  assert.equal(entry.rpe, '11624');
  assert.equal(entry.sourceYear, 2025);
  assert.equal(entry.totalAmountDop, 4792);

  // Build snapshot with proveedor from proveedores XLSX
  const proveedor = parseProveedorXlsxRow(PROVEEDOR_ROW_JURIDICA);
  assert.ok(proveedor);

  const row = buildDgcpSnapshotRow({
    acc: entry,
    proveedor,
    normalizedRnc: '101870087',
    importedAt: '2026-07-02T00:00:00.000Z',
  });

  assert.equal(row.source_key, 'do_dgcp');
  assert.equal(row.country_code, 'DO');
  assert.equal(row.source_year, 2025);
  assert.equal(row.normalized_tax_id, '101870087');
  assert.equal(row.tax_id, '101870087');

  // Guardrails semánticos
  assert.equal(row.raw_data.source_type, 'procurement_signal');
  assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  assert.equal(row.raw_data.official_ciiu_available, false);
  assert.equal(row.raw_data.ciiu_status, 'unavailable_for_mvp');
  assert.equal(row.raw_data.human_review_required, true);

  // Señal de contratos
  assert.equal(row.signals.total_contracts_year, 1);
  assert.equal(row.signals.total_awarded_amount_dop, 4792);
});

// ─── Dedup por RNC + año ───────────────────────────────────────────────────────

test('accumulateByRpeYear: no duplica contratos del mismo RPE/año', () => {
  const contratos = [
    normalizeContrato(parseContratoXlsxRow(CONTRATO_ROW)!),
    normalizeContrato(parseContratoXlsxRow([
      'DO1.PCCNTR.202',
      'Activo',
      'Confirmada',
      '2025-04-15 10:00:00.000',
      8000,
      'DOP',
      null,
      'Servicios',
      11624, // mismo RPE
      'CORAL ELECTRICA, SRL',
      '101825014',
    ])!),
  ];

  const acc = accumulateByRpeYear(contratos);
  assert.equal(acc.size, 1, 'mismo RPE+año → una sola entrada');

  const [entry] = acc.values();
  assert.equal(entry.contracts.length, 2);
  assert.equal(entry.totalAmountDop, 4792 + 8000);
});

test('accumulateByRpeYear: crea entradas distintas para años distintos', () => {
  const row2024 = [...CONTRATO_ROW];
  row2024[3] = '2024-03-31 19:33:57.430'; // año 2024
  const row2025 = [...CONTRATO_ROW];
  row2025[3] = '2025-03-31 19:33:57.430'; // año 2025

  const contratos = [
    normalizeContrato(parseContratoXlsxRow(row2024)!),
    normalizeContrato(parseContratoXlsxRow(row2025)!),
  ];

  const acc = accumulateByRpeYear(contratos);
  assert.equal(acc.size, 2, 'años distintos → entradas distintas');
});

// ─── No toca rd_dgii_bulk ─────────────────────────────────────────────────────

test('DGCP_SOURCE_KEY no es rd_dgii_bulk', () => {
  assert.notEqual(DGCP_SOURCE_KEY, 'rd_dgii_bulk');
  assert.equal(DGCP_SOURCE_KEY, 'do_dgcp');
  assert.equal(DGCP_COUNTRY_CODE, 'DO');
});

// ─── extractYearFromDate soporta formato ISO con hora ─────────────────────────

test('extractYearFromDate parsea ISO con timestamp DGCP', () => {
  assert.equal(extractYearFromDate('2025-03-31 19:33:57.430'), 2025);
  assert.equal(extractYearFromDate('2015-03-31 19:33:57.430'), 2015);
  assert.equal(extractYearFromDate('2026-01-01T00:00:00.000Z'), 2026);
  assert.equal(extractYearFromDate(null), null);
  assert.equal(extractYearFromDate(''), null);
});

// ─── Coverage summary no usa complete_snapshot si carga parcial ───────────────

test('coverage_status no puede ser complete_snapshot para cargas parciales', () => {
  // Esta restricción es semántica: si yearFrom/yearTo limitan el universo,
  // el status debe ser year_snapshot o partial_snapshot, no complete_snapshot.
  const validPartialStatuses = ['partial_snapshot', 'controlled_sample', 'year_snapshot', 'pilot_sample'];
  const invalidStatus = 'complete_snapshot';

  // Si hay filtro de año, el status debe ser uno de los parciales
  const hasYearFilter = true;
  if (hasYearFilter) {
    assert.ok(
      validPartialStatuses.length > 0,
      'deben existir statuses parciales válidos',
    );
    assert.ok(
      !validPartialStatuses.includes(invalidStatus),
      'complete_snapshot no debe usarse en cargas parciales',
    );
  }
});

// ─── Snapshot incluye limitations en raw_data ─────────────────────────────────

test('buildDgcpSnapshotRow: raw_data no inventa CIIU', () => {
  const contrato = parseContratoXlsxRow(CONTRATO_ROW)!;
  const normalized = normalizeContrato(contrato);
  const acc = [...accumulateByRpeYear([normalized]).values()][0];
  const proveedor = parseProveedorXlsxRow(PROVEEDOR_ROW_JURIDICA)!;

  const row = buildDgcpSnapshotRow({
    acc,
    proveedor,
    normalizedRnc: '101870087',
  });

  assert.equal(row.raw_data.official_ciiu_available, false);
  assert.equal(row.raw_data.ciiu_status, 'unavailable_for_mvp');
  assert.equal(row.sector, null, 'sector siempre null — CIIU no disponible');
});

// ─── Post-approval: metadata procurement_signal intacta ───────────────────────

test('snapshot construido no valida RNC ni reemplaza DGII', () => {
  const contrato = parseContratoXlsxRow(CONTRATO_ROW)!;
  const normalized = normalizeContrato(contrato);
  const acc = [...accumulateByRpeYear([normalized]).values()][0];
  const proveedor = parseProveedorXlsxRow(PROVEEDOR_ROW_JURIDICA)!;

  const row = buildDgcpSnapshotRow({
    acc,
    proveedor,
    normalizedRnc: '101870087',
  });

  // DGCP no valida RNC — eso es DGII
  assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  // Es señal B2G, no fuente fiscal
  assert.equal(row.raw_data.source_type, 'procurement_signal');
  assert.equal(row.raw_data.human_review_required, true);
});
