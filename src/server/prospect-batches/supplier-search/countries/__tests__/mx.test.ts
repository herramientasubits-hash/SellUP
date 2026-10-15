/**
 * Tests — México en «Proveedores de una empresa» (Compras MX, AGENT1-SUPPLIER-SEARCH-MX-1).
 * Filas reales recortadas de «Contratos de la Plataforma Integral Compras MX 2025/2026»
 * (datos abiertos, bajados el 15-10-2026), sólo personas morales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MX_COUNTRY, isMxPublicBodyName, isMxSmallStratification, normalizeMxBuyerName, parseMxCompanyRfc } from '../mx';
import { createMxLoader, mxAmountInPesos, mxLinesFromRecord, parseMxDate } from '../mx.loader';
import {
  MX_HEALTH_INTEGRATED_SERVICES_FAMILY,
  MX_PARTIDA_CLASSIFIER,
  MX_PARTIDA_MACRO,
  MX_PARTIDA_MACRO_TABLE_APPROVED,
  splitMxPartidas,
} from '../mx-partida-macro-table';
import { MX_COMPRASMX_CATALOG_SOURCE } from '../mx.catalog';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import type { ProcurementLine } from '../../procurement-links';
import { aggregate, runStep } from './loaded-country-harness';

const RECORD = (overrides: Record<string, string> = {}): Record<string, string> => ({
  'Clave Ramo': '50',
  'Clave Institución': '050GYR',
  'Siglas de la Institución': 'IMSS',
  'Institución': 'INSTITUTO MEXICANO DEL SEGURO SOCIAL',
  'Partida específica': '25301',
  'Código del contrato': 'C-2025-00012345',
  'Núm. del contrato': 'IMSS-0001/2025',
  'Fecha de inicio del contrato': '01/04/2025',
  'Fecha de firma del contrato': '2025-03-28 00:00:00',
  'Importe DRC': '17832000000.00',
  'Moneda': 'MXN',
  rfc: 'PFI730206632',
  'Proveedor o contratista': 'PFIZER SA DE CV',
  'País de la empresa': 'MX',
  'Estratificación': 'NO MIPYME',
  'Dirección del anuncio': 'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/abc/procedimiento',
  ...overrides,
});

const WINDOW = { start: '2025-01-01', end: '2025-12-31' };

describe('1. RFC, tamaño y entidades públicas', () => {
  it('sólo RFC de persona moral mexicana (12, fecha válida); fuera físicas, extranjeros genéricos y otro país', () => {
    assert.equal(parseMxCompanyRfc('pfi730206632', 'MX'), 'PFI730206632');
    assert.equal(parseMxCompanyRfc('A&K0512024K4', ''), 'A&K0512024K4');
    assert.equal(parseMxCompanyRfc('GODE561231GR8', 'MX'), null, 'persona física (13)');
    assert.equal(parseMxCompanyRfc('EXT990101NI1', 'MX'), null, 'RFC genérico de extranjero');
    assert.equal(parseMxCompanyRfc('PFI730206632', 'US'), null);
    assert.equal(parseMxCompanyRfc('PFI731306632', 'MX'), null, 'mes 13');
  });

  it('MICRO y PEQUEÑA fuera; MEDIANA, GRANDE y NO MIPYME se quedan', () => {
    assert.equal(isMxSmallStratification('MICRO'), true);
    assert.equal(isMxSmallStratification('PEQUEÑA'), true);
    for (const kept of ['MEDIANA', 'GRANDE', 'NO MIPYME', 'NO ASIGNADO', '']) assert.equal(isMxSmallStratification(kept), false, kept);
  });

  it('entidades y empresas del Estado que salen como proveedoras', () => {
    for (const name of ['CASA DE MONEDA DE MEXICO', 'SERVICIO POSTAL MEXICANO', 'GOBIERNO DE LA CIUDAD DE MEXICO', 'LABORATORIOS DE BIOLOGICOS Y REACTIVOS DE MEXICO SA DE CV', 'ALIMENTACIÓN PARA EL BIENESTAR, S.A. DE C.V.', 'SECRETARIA DE SEGURIDAD Y PROTECCION CIUDADANA SERVICIO DE PROTECCION FEDERAL']) {
      assert.equal(isMxPublicBodyName(name), true, name);
    }
    for (const name of ['SERVICIOS BROXEL S A P I DE CV', 'INFRA SA DE CV', 'SERVICIOS MEDICOS Y DE EQUIPAMIENTO SA DE CV', 'HITACHI RAIL GTS MEXICO']) {
      assert.equal(isMxPublicBodyName(name), false, name);
    }
  });

  it('nombre de la institución: siglas y la SICT sin «Secretaría de» llegan a la misma forma', () => {
    assert.equal(normalizeMxBuyerName('IMSS'), 'INSTITUTO MEXICANO DEL SEGURO SOCIAL');
    assert.equal(normalizeMxBuyerName('I.M.S.S.'), 'INSTITUTO MEXICANO DEL SEGURO SOCIAL');
    assert.equal(normalizeMxBuyerName('Instituto Mexicano del Seguro Social'), 'INSTITUTO MEXICANO DEL SEGURO SOCIAL');
    assert.equal(normalizeMxBuyerName('IMSS-Bienestar'), normalizeMxBuyerName('SERVICIOS DE SALUD DEL INSTITUTO MEXICANO DEL SEGURO SOCIAL PARA EL BIENESTAR (IMSS-BIENESTAR)'));
    assert.equal(normalizeMxBuyerName('INFRAESTRUCTURA, COMUNICACIONES Y TRANSPORTES'), normalizeMxBuyerName('Secretaría de Infraestructura, Comunicaciones y Transportes'));
    assert.equal(normalizeMxBuyerName('SICT'), normalizeMxBuyerName('Secretaría de Infraestructura, Comunicaciones y Transportes'));
  });
});

describe('2. lector', () => {
  it('fecha de firma ISO; si falta, la de inicio dd/mm/aaaa', () => {
    assert.equal(parseMxDate('2026-03-23 00:00:00', '24/03/2026'), '2026-03-23');
    assert.equal(parseMxDate('', '24/03/2026'), '2026-03-24');
    assert.equal(parseMxDate('', ''), null);
  });

  it('monto en pesos; dólares al cambio fijo; moneda desconocida = 0', () => {
    assert.equal(mxAmountInPesos('63666.95', 'MXN'), 63666.95);
    assert.equal(mxAmountInPesos('1000', 'USD'), 18_500);
    assert.equal(mxAmountInPesos('1000', 'JPY'), 0);
    assert.equal(mxAmountInPesos('', 'MXN'), 0);
  });

  it('varias partidas: familias de 3 dígitos sin repetir y monto repartido', () => {
    assert.deepEqual(splitMxPartidas('25401, 25501, 25901, 25402'), ['254', '255', '259']);
    const lines = mxLinesFromRecord(RECORD({ 'Partida específica': '25401, 25501', 'Importe DRC': '1000' }), WINDOW);
    assert.deepEqual(lines.map((l) => [l.classificationKey, l.amount]), [['254', 500], ['255', 500]]);
    assert.equal(lines[0].buyerCode, '050GYR');
    assert.equal(lines[0].orderCode, 'C-2025-00012345');
    assert.match(lines[0].orderUrl ?? '', /^https:\/\/comprasmx/);
  });

  it('339 de un ramo de salud = servicios integrales médicos; de otro ramo, sin macro', () => {
    assert.equal(mxLinesFromRecord(RECORD({ 'Partida específica': '33903' }), WINDOW)[0].classificationKey, MX_HEALTH_INTEGRATED_SERVICES_FAMILY);
    assert.equal(mxLinesFromRecord(RECORD({ 'Partida específica': '33901', 'Clave Ramo': '09' }), WINDOW)[0].classificationKey, '339');
  });

  it('fuera de la ventana, persona física, pequeña o entidad pública: ninguna línea', () => {
    assert.equal(mxLinesFromRecord(RECORD({ 'Fecha de firma del contrato': '2024-12-31 00:00:00' }), WINDOW).length, 0);
    assert.equal(mxLinesFromRecord(RECORD({ rfc: 'GODE561231GR8' }), WINDOW).length, 0);
    assert.equal(mxLinesFromRecord(RECORD({ 'Estratificación': 'MICRO' }), WINDOW).length, 0);
    assert.equal(mxLinesFromRecord(RECORD({ 'Proveedor o contratista': 'CASA DE MONEDA DE MEXICO', rfc: 'CMM860120KI1' }), WINDOW).length, 0);
  });

  it('archivo latin-1: lee la primera «Moneda», y el mismo contrato en dos archivos cuenta una vez', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mx-loader-'));
    const header = ['Clave Ramo', 'Clave Institución', 'Institución', 'Partida específica', 'Código del contrato', 'Fecha de firma del contrato', 'Importe DRC', 'Moneda', 'Monto sin imp./máximo', 'Moneda', 'rfc', 'Proveedor o contratista', 'País de la empresa', 'Estratificación'];
    const row = ['50', '050GYR', 'INSTITUTO MEXICANO DEL SEGURO SOCIAL', '25301', 'C-2025-1', '2025-03-28 00:00:00', '1000000', 'MXN', '1', 'USD', 'PFI730206632', 'PFIZER SA DE CV', 'MX', 'GRANDE'];
    const csv = `${header.join(',')}\n${row.join(',')}\n`;
    for (const year of [2025, 2026]) writeFileSync(join(dir, `contratos_comprasmx_${year}.csv`), Buffer.from(csv, 'latin1'));
    const loader = createMxLoader();
    const files = loader.files({ year: 2026, month: 2 }, 12);
    assert.deepEqual(files.map((f) => f.name), ['contratos_comprasmx_2025.csv', 'contratos_comprasmx_2026.csv']);
    assert.ok(files.every((f) => f.url.startsWith('manual:')), 'descarga a mano');
    const lines: ProcurementLine[] = [];
    for (const f of files) await loader.readLines(join(dir, f.name), (line) => lines.push(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].amount, 1_000_000, 'la primera «Moneda» (MXN), no la del monto máximo');
    assert.equal(lines[0].buyerName, 'INSTITUTO MEXICANO DEL SEGURO SOCIAL', 'acentos latin-1 bien leídos en el encabezado');
  });

  it('un archivo que no es el CSV de Compras MX se rechaza con la instrucción de bajarlo a mano', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mx-loader-'));
    const path = join(dir, 'contratos_comprasmx_2026.csv');
    writeFileSync(path, '<html><body>Compras MX</body></html>\n');
    const loader = createMxLoader();
    loader.files({ year: 2026, month: 9 }, 12);
    await assert.rejects(loader.readLines(path, () => undefined), /mx_csv_no_reconocido/);
  });
});

describe('3. tabla de partidas (BORRADOR)', () => {
  it('sigue en borrador y sólo usa macros del catálogo', () => {
    assert.equal(MX_PARTIDA_MACRO_TABLE_APPROVED, false);
    const keys = new Set<string>(MACRO_INDUSTRY_KEYS);
    for (const [family, [macro, label]] of Object.entries(MX_PARTIDA_MACRO)) {
      if (macro !== null) assert.ok(keys.has(macro), `${family} ${macro}`);
      assert.ok(label.length >= 3, family);
      assert.notEqual(macro, 'government', `${family}: un proveedor nunca es Gobierno`);
    }
  });

  it('regla del 50 %: una partida sin macro cuenta en el total pero no clasifica', () => {
    assert.deepEqual(MX_PARTIDA_CLASSIFIER.classify({ '253': 60, '441': 40 }), { macroIndustryKey: 'health_pharma', share: 0.6 });
    assert.equal(MX_PARTIDA_CLASSIFIER.classify({ '253': 40, '441': 60 }), null);
    assert.deepEqual(MX_PARTIDA_CLASSIFIER.classify({ [MX_HEALTH_INTEGRATED_SERVICES_FAMILY]: 100 }), { macroIndustryKey: 'health_pharma', share: 1 });
    assert.equal(MX_PARTIDA_CLASSIFIER.classify({ '339': 100 }), null);
    assert.equal(MX_PARTIDA_CLASSIFIER.rubroOf('253'), 'Medicinas y productos farmacéuticos');
    assert.equal(MX_PARTIDA_CLASSIFIER.rubroOf('999'), null);
  });
});

describe('4. de punta a punta: «IMSS» × Salud', () => {
  const lines = [
    ...mxLinesFromRecord(RECORD(), WINDOW),
    ...mxLinesFromRecord(RECORD({ rfc: 'INF891031LT4', 'Proveedor o contratista': 'INFRA SA DE CV', 'Partida específica': '33903', 'Código del contrato': 'C-2025-2', 'Importe DRC': '3634000000', 'Estratificación': 'GRANDE' }), WINDOW),
    ...mxLinesFromRecord(RECORD({ rfc: 'MME100125RS6', 'Proveedor o contratista': 'CONSTRUCTORA SA DE CV', 'Partida específica': '62201', 'Código del contrato': 'C-2025-3', 'Importe DRC': '500000000' }), WINDOW),
    ...mxLinesFromRecord(RECORD({ rfc: 'BAC920106U98', 'Proveedor o contratista': 'BIODIST SA DE CV', 'Código del contrato': 'C-2025-4', 'Importe DRC': '100000' }), WINDOW),
  ];

  it('reconoce el IMSS por sus siglas y ofrece sólo las de Salud, todas al rescate (sin web por RFC)', async () => {
    const links = aggregate(MX_COUNTRY, lines);
    assert.equal(links.length, 3, 'el par de MXN 100 mil queda bajo el piso de MXN 185 mil');
    const { outcome, written, recorded } = await runStep(MX_COUNTRY, links, [], { referenceCompanyName: 'IMSS', macroIndustryKey: 'health_pharma' });
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, '050GYR');
    assert.equal(outcome.offered, 2);
    assert.equal(written.length, 0);
    assert.deepEqual(recorded.map((c) => [c.taxId, c.taxIdentifierType]).sort(), [['INF891031LT4', 'RFC'], ['PFI730206632', 'RFC']]);
  });
});

describe('5. Catálogo de fuentes', () => {
  it('connected_free_discovery, pendiente de validar, compras públicas', () => {
    assert.equal(MX_COMPRASMX_CATALOG_SOURCE.key, MX_COUNTRY.sourceKey);
    assert.equal(MX_COMPRASMX_CATALOG_SOURCE.aiFlowStatus, 'connected_free_discovery');
    assert.equal(MX_COMPRASMX_CATALOG_SOURCE.operationalStatus, 'pending_validation');
    assert.equal(MX_COMPRASMX_CATALOG_SOURCE.type, 'procurement');
  });
});
