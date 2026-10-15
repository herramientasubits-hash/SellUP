/**
 * Tests — Argentina en «Proveedores de una empresa» (COMPR.AR, AGENT1-SUPPLIER-SEARCH-ALL-1).
 * Filas reales recortadas de «Adjudicaciones 2016-2026» (datos.gob.ar, 03-08-2026), sólo empresas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AR_COUNTRY, isArCompanyCuit, isArPublicBodyName, normalizeArBuyerName, parseArCuit } from '../ar';
import { arAmountInPesos, arLinesFromRecord, createArLoader, parseArDate } from '../ar.loader';
import { AR_RUBRO_CLASSIFIER, AR_RUBRO_MACRO, AR_RUBRO_MACRO_TABLE_APPROVED, splitArRubros } from '../ar-rubro-macro-table';
import { AR_COMPRAR_CATALOG_SOURCE } from '../ar.catalog';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { aggregate, runStep } from './loaded-country-harness';

const RECORD = (overrides: Record<string, string> = {}): Record<string, string> => ({
  Numero_Proceso: '80-0012-LPU26',
  Nro_SAF: '310',
  Descripcion_SAF: '310 - Ministerio de Salud',
  Fecha_de_Adjudicacion: '12/03/2026 11:20:00 a.m.',
  Rubros: 'PROD. MEDICO/FARMACEUTICOS/LAB;',
  CUIT: '30-500987185',
  Descripcion_Proveedor: 'GADOR S A',
  Documento_Contractual: '80-1131-OC26',
  Monto: '27579000000.00',
  Moneda: 'Peso Argentino',
  Tipo_de_Operacion: 'Proceso de Compra',
  ...overrides,
});

const WINDOW = { start: '2025-08-01', end: '2026-07-31' };

describe('1. número fiscal y nombres', () => {
  it('CUIT de 11 dígitos con verificador; los de 12 con el verificador repetido se corrigen', () => {
    assert.equal(parseArCuit('30-50098718-5'), '30500987185');
    assert.equal(parseArCuit('30-656088636-6'), '30656088636', 'cuerpo con el verificador repetido');
    assert.equal(parseArCuit('30-711720487-7'), '30711720487');
    assert.equal(parseArCuit('30-50098718-4'), null, 'verificador incorrecto');
    assert.equal(parseArCuit('30-711720487-3'), null, '12 dígitos sin el verificador repetido');
    assert.equal(parseArCuit('12345'), null);
  });

  it('sólo personas jurídicas (30/33/34); fuera personas físicas', () => {
    assert.equal(isArCompanyCuit('30500987185'), true);
    assert.equal(isArCompanyCuit('33714573379'), true);
    assert.equal(isArCompanyCuit('20230506060'), false);
    assert.equal(isArCompanyCuit('27123456789'), false);
  });

  it('organismos y sociedades del Estado de la capa de Gobierno quedan fuera; empresas privadas no', () => {
    assert.equal(isArPublicBodyName('SINDICATURA GENERLA DE LA NACION'), true);
    assert.equal(isArPublicBodyName('BANCO DE LA NACIÓN ARGENTINA'), true);
    assert.equal(isArPublicBodyName('CASA DE MONEDA S.A.U.'), true);
    assert.equal(isArPublicBodyName('Universidad Nacional de La Plata'), true);
    assert.equal(isArPublicBodyName('NOVARTIS ARGENTINA SA'), false);
    assert.equal(isArPublicBodyName('BANCO MACRO S.A.'), false);
  });

  it('nombre del SAF sin su número', () => {
    assert.equal(normalizeArBuyerName('310 - Ministerio de Salud'), 'MINISTERIO DE SALUD');
    assert.equal(normalizeArBuyerName('Estado Mayor General de La Fuerza Aérea'), 'ESTADO MAYOR GENERAL DE LA FUERZA AEREA');
  });
});

describe('2. lector del CSV', () => {
  it('una línea por rubro, con el monto repartido en partes iguales', () => {
    const lines = arLinesFromRecord(RECORD({ Rubros: 'FERRETERIA;HERRAMIENTAS;', Monto: '1000000.00' }), WINDOW);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => [l.classificationKey, l.amount]), [['FERRETERIA', 500_000], ['HERRAMIENTAS', 500_000]]);
    assert.deepEqual(
      { buyerCode: lines[0].buyerCode, buyerName: lines[0].buyerName, supplierTaxId: lines[0].supplierTaxId, orderCode: lines[0].orderCode, date: lines[0].date },
      { buyerCode: 'SAF-310', buyerName: 'Ministerio de Salud', supplierTaxId: '30500987185', orderCode: '80-1131-OC26', date: '2026-03-12' },
    );
  });

  it('fuera: «Genera Recursos», fuera de la ventana, personas físicas y organismos', () => {
    assert.equal(arLinesFromRecord(RECORD({ Tipo_de_Operacion: 'Genera Recursos' }), WINDOW).length, 0);
    assert.equal(arLinesFromRecord(RECORD({ Fecha_de_Adjudicacion: '28/12/2016 04:05:45 p.m.' }), WINDOW).length, 0);
    assert.equal(arLinesFromRecord(RECORD({ CUIT: '20-23050606-0', Descripcion_Proveedor: 'Persona' }), WINDOW).length, 0);
    assert.equal(arLinesFromRecord(RECORD({ CUIT: '33-658406219-9', Descripcion_Proveedor: 'SINDICATURA GENERLA DE LA NACION' }), WINDOW).length, 0);
  });

  it('dólares y euros pasan a pesos; moneda desconocida = 0', () => {
    assert.equal(arAmountInPesos('429969.93', 'Dolar Estadounidense'), 429969.93 * 1_450);
    assert.equal(arAmountInPesos('100', 'Euro - European Monetary Union'), 165_000);
    assert.equal(arAmountInPesos('100', 'Yen'), 0);
    assert.equal(parseArDate('30/12/2016 03:21:53 p.m.'), '2016-12-30');
  });

  it('la ventana la fija files() y el archivo lleva el mes final en el nombre', () => {
    const loader = createArLoader();
    const files = loader.files({ year: 2026, month: 7 }, 12);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'ar-adjudicaciones-hasta-2026-7.csv');
    assert.match(files[0].url, /^https:\/\/infra\.datos\.gob\.ar\//);
  });
});

describe('3. tabla de rubros (BORRADOR)', () => {
  it('sigue en borrador y sólo usa macros del catálogo', () => {
    assert.equal(AR_RUBRO_MACRO_TABLE_APPROVED, false);
    const keys = new Set<string>(MACRO_INDUSTRY_KEYS);
    for (const macro of Object.values(AR_RUBRO_MACRO)) if (macro !== null) assert.ok(keys.has(macro), macro);
    assert.equal(Object.keys(AR_RUBRO_MACRO).length, 49);
  });

  it('rubros del CSV (con dobles espacios) → clave de la tabla', () => {
    assert.deepEqual(splitArRubros('SANITARIOS  PLOMERIA Y GAS;INFORMATICA;INFORMATICA;'), ['SANITARIOS PLOMERIA Y GAS', 'INFORMATICA']);
  });

  it('regla del 50 %: un rubro sin macro cuenta en el total pero no clasifica', () => {
    assert.deepEqual(AR_RUBRO_CLASSIFIER.classify({ INFORMATICA: 60, EQUIPOS: 40 }), { macroIndustryKey: 'technology', share: 0.6 });
    assert.equal(AR_RUBRO_CLASSIFIER.classify({ INFORMATICA: 40, EQUIPOS: 60 }), null);
    assert.equal(AR_RUBRO_CLASSIFIER.rubroOf('PROD. MEDICO/FARMACEUTICOS/LAB'), 'Prod. medico/farmaceuticos/lab');
    assert.equal(AR_RUBRO_CLASSIFIER.rubroOf('NO EXISTE'), null);
  });
});

describe('4. de punta a punta: «Ministerio de Salud» × Salud', () => {
  const lines = [
    ...arLinesFromRecord(RECORD(), WINDOW),
    ...arLinesFromRecord(RECORD({ CUIT: '30-711720487-7', Descripcion_Proveedor: 'SINERGIUM BIOTECH S.A.', Documento_Contractual: '80-1201-OC26', Monto: '30508000000.00' }), WINDOW),
    ...arLinesFromRecord(RECORD({ CUIT: '30-50518137-5', Descripcion_Proveedor: 'SOFTWARE SRL', Rubros: 'INFORMATICA;', Monto: '90000000.00' }), WINDOW),
    ...arLinesFromRecord(RECORD({ CUIT: '30-65608863-6', Descripcion_Proveedor: 'CHICO SRL', Monto: '1000000.00', Documento_Contractual: 'X' }), WINDOW),
  ];

  it('ofrece sólo las de Salud, con web de RNS cuando la hay', async () => {
    const links = aggregate(AR_COUNTRY, lines);
    assert.equal(links.length, 3, 'el par de ARS 1 millón queda bajo el piso de ARS 15 millones');
    const { outcome, written, recorded } = await runStep(
      AR_COUNTRY,
      links,
      [{ country_code: 'AR', source_key: 'ar_rns', tax_id: '30500987185', normalized_tax_id: '30500987185', raw_data: { website_domain: 'gador.com.ar' } }],
      { referenceCompanyName: 'Ministerio de Salud', macroIndustryKey: 'health_pharma' },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, 'SAF-310');
    assert.equal(outcome.offered, 2);
    assert.deepEqual(written.map((c) => [c.taxId, c.domain, c.taxIdentifierType]), [['30500987185', 'gador.com.ar', 'CUIT']]);
    assert.deepEqual(recorded.map((c) => c.taxId), ['30711720487']);
    assert.match(outcome.relationships[0].evidence, /prod\. medico\/farmaceuticos\/lab/);
  });
});

describe('5. Catálogo de fuentes', () => {
  it('connected_free_discovery, pendiente de validar, compras públicas', () => {
    assert.equal(AR_COMPRAR_CATALOG_SOURCE.key, AR_COUNTRY.sourceKey);
    assert.equal(AR_COMPRAR_CATALOG_SOURCE.aiFlowStatus, 'connected_free_discovery');
    assert.equal(AR_COMPRAR_CATALOG_SOURCE.operationalStatus, 'pending_validation');
    assert.equal(AR_COMPRAR_CATALOG_SOURCE.type, 'procurement');
  });
});
