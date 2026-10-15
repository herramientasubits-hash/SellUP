/**
 * Tests — Uruguay en «Proveedores de una empresa» (ARCE OCDS, AGENT1-SUPPLIER-SEARCH-ALL-1).
 * Adjudicación real recortada de «2025/a-12-2025.json» (ocds-2025.zip), sólo empresas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UY_ARCE_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/uy-arce-macro-table';
import { isUyCompanySupplier, parseUyRutId, UY_ARCE_CLASSIFIER, UY_COUNTRY, uyBuyerOf } from '../uy';
import { createUyLoader, uyItemAmount, uyLinesFromRelease, type UyOcdsRelease } from '../uy.loader';
import { UY_ARCE_AWARDS_CATALOG_SOURCE } from '../uy.catalog';
import { aggregate, runStep } from './loaded-country-harness';

/** Artículo SICE → clase (del catálogo imp_catalogo.tgz). */
const ARTICLES = new Map([
  ['37078', '2-9-4'], // APOSITO HIDROCOLOIDES (útiles menores médico-quirúrgicos)
  ['31273', '2-13-1'], // CEFUROXIME (medicamentos)
  ['1880', '2-9-1'], // CARTUCHO DE TONER PARA IMPRESORA (otros materiales: sin macro)
]);

const RELEASE = (overrides: Partial<UyOcdsRelease> = {}): UyOcdsRelease => ({
  ocid: 'ocds-yfs5dr-1297941',
  date: '2025-12-01T06:35:00Z',
  buyer: { id: '29-76', name: 'Hospital Español' },
  awards: [
    {
      status: 'active',
      date: '2025-11-21T00:00:00Z',
      documents: [{ url: 'https://www.comprasestatales.gub.uy/Resoluciones/acta_1297941.PDF' }],
      items: [
        { quantity: 500, classification: { id: '37078', scheme: 'x_catalogo_arce' }, unit: { value: { amount: 80, currency: 'UYU' } } },
        { quantity: 1, classification: { id: '0', scheme: 'x_ODG' }, unit: { value: { amount: 100, currency: 'USD' } } },
      ],
      suppliers: [{ id: 'R/219836710014', name: 'W MEDICAL SA' }],
    },
    {
      status: 'active',
      items: [{ quantity: 1, classification: { id: '1880', scheme: 'x_catalogo_arce' }, unit: { value: { amount: 10, currency: 'UYU' } } }],
      suppliers: [{ id: 'C/12345678', name: 'Persona' }],
    },
    {
      status: 'cancelled',
      items: [{ quantity: 1, classification: { id: '1880', scheme: 'x_catalogo_arce' }, unit: { value: { amount: 10, currency: 'UYU' } } }],
      suppliers: [{ id: 'R/219836710014', name: 'W MEDICAL SA' }],
    },
  ],
  ...overrides,
});

describe('1. comprador, RUT y montos', () => {
  it('unidad ejecutora → su inciso con nombre oficial; intendencias por departamento', () => {
    assert.deepEqual(uyBuyerOf('29-76', 'Hospital Español'), { code: 'INCISO-29', name: 'Administración de los Servicios de Salud del Estado (ASSE)' });
    assert.deepEqual(uyBuyerOf('12-103', 'Dirección General de la Salud'), { code: 'INCISO-12', name: 'Ministerio de Salud Pública' });
    assert.deepEqual(uyBuyerOf('98-1', 'Intendencia de Montevideo'), { code: 'INCISO-98', name: 'Intendencia de Montevideo' });
    assert.deepEqual(uyBuyerOf('17-1', 'Tribunal de Cuentas'), { code: 'INCISO-17', name: 'Tribunal de Cuentas' }, 'sin tabla: el de la unidad');
    assert.equal(uyBuyerOf('', null), null);
  });

  it('RUT con dígito verificador; cédulas, extranjeros y entes del Estado fuera', () => {
    assert.equal(parseUyRutId('R/211014180012'), '211014180012');
    assert.equal(parseUyRutId('R/211014180013'), null, 'verificador incorrecto');
    assert.equal(parseUyRutId('C/12345678'), null);
    assert.equal(parseUyRutId('X/123'), null);
    assert.equal(isUyCompanySupplier('211014180012', 'LABORATORIO GADOR S A'), true);
    assert.equal(isUyCompanySupplier('211014180012', 'Administración Nacional de Telecomunicaciones'), false);
  });

  it('monto del ítem en pesos con cambio fijo; absurdos y sin moneda = 0', () => {
    assert.equal(uyItemAmount({ quantity: 500, unit: { value: { amount: 80, currency: 'UYU' } } }), 40_000);
    assert.equal(uyItemAmount({ quantity: 2, unit: { value: { amount: 100, currency: 'USD' } } }), 8_000);
    assert.equal(uyItemAmount({ quantity: 1, unit: { value: { amount: 100 } } }), 0);
    assert.equal(uyItemAmount({ quantity: 1e6, unit: { value: { amount: 1e6, currency: 'USD' } } }), 0);
  });
});

describe('2. lector del OCDS', () => {
  it('una línea por ítem de cada proveedor empresa, con la clase SICE y el acta como prueba', () => {
    const lines = uyLinesFromRelease(RELEASE(), ARTICLES);
    assert.equal(lines.length, 2, 'la persona (C/) y la adjudicación cancelada quedan fuera');
    assert.deepEqual(lines.map((l) => [l.classificationKey, l.amount]), [['2-9-4', 40_000], [null, 4_000]]);
    assert.equal(lines[0].buyerCode, 'INCISO-29');
    assert.equal(lines[0].supplierTaxId, '219836710014');
    assert.equal(lines[0].orderCode, 'ocds-yfs5dr-1297941');
    assert.equal(lines[0].orderUrl, 'https://www.comprasestatales.gub.uy/Resoluciones/acta_1297941.PDF');
    assert.equal(lines[0].date, '2025-11-21');
  });

  it('files(): catálogo SICE primero y un zip por año de la ventana; año sin publicar ⇒ error claro', () => {
    const files = createUyLoader().files({ year: 2025, month: 12 }, 12);
    assert.deepEqual(files.map((f) => f.name), ['uy-sice-catalogo.tgz', 'uy-ocds-2025.zip']);
    assert.deepEqual(createUyLoader().files({ year: 2025, month: 3 }, 12).map((f) => f.name), ['uy-sice-catalogo.tgz', 'uy-ocds-2024.zip', 'uy-ocds-2025.zip']);
    assert.throws(() => createUyLoader().files({ year: 2026, month: 9 }, 12), /uy_ocds_year_not_published:2026/);
  });
});

describe('3. tabla SICE aprobada', () => {
  it('usa la tabla aprobada de la capa gratuita (clase manda; regla del 50 %)', () => {
    assert.equal(UY_ARCE_CLASSIFIER.tableVersion, UY_ARCE_MACRO_TABLE_VERSION);
    assert.deepEqual(UY_ARCE_CLASSIFIER.classify({ '2-13-1': 70, '4-2-1': 30 }), { macroIndustryKey: 'health_pharma', share: 0.7 });
    assert.equal(UY_ARCE_CLASSIFIER.classify({ '3-10-1': 70 })?.macroIndustryKey, 'technology');
    assert.equal(UY_ARCE_CLASSIFIER.classify({ '2-13-1': 40, '4-2-1': 60 })?.macroIndustryKey, 'technology');
    assert.equal(UY_ARCE_CLASSIFIER.classify({ '2-9-9': 100 }), null, 'subfamilia «otros» sin clase en la tabla');
    assert.equal(UY_ARCE_CLASSIFIER.rubroOf('3-8-2'), 'Servicios médicos');
    assert.equal(UY_ARCE_CLASSIFIER.rubroOf('2-13-1'), 'Medicamentos y antisépticos de uso humano');
    assert.equal(UY_ARCE_CLASSIFIER.rubroOf(null), null);
  });
});

describe('4. de punta a punta: «ASSE» × Salud', () => {
  it('reconoce el organismo por su nombre oficial y ofrece su proveedor de Salud', async () => {
    const big = RELEASE({
      awards: [
        {
          status: 'active',
          documents: [{ url: 'https://www.comprasestatales.gub.uy/Resoluciones/acta_1240244.pdf' }],
          items: [{ quantity: 100_000, classification: { id: '31273', scheme: 'x_catalogo_arce' }, unit: { value: { amount: 50, currency: 'UYU' } } }],
          suppliers: [{ id: 'R/211014180012', name: 'LABORATORIO GADOR S A' }],
        },
      ],
    });
    const links = aggregate(UY_COUNTRY, [...uyLinesFromRelease(RELEASE(), ARTICLES), ...uyLinesFromRelease(big, ARTICLES)]);
    assert.equal(links.length, 1, 'W MEDICAL (UYU 44 mil) queda bajo el piso de UYU 400 mil');
    const { outcome, written, recorded } = await runStep(
      UY_COUNTRY,
      links,
      [{ country_code: 'UY', source_key: 'uy_arce_directory', tax_id: '211014180012', normalized_tax_id: '211014180012', raw_data: { website_domain: 'gador.com.uy' } }],
      { referenceCompanyName: 'Administración de los Servicios de Salud del Estado', macroIndustryKey: 'health_pharma' },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.matchedBy, 'prefix');
    assert.deepEqual(written.map((c) => [c.taxId, c.domain, c.taxIdentifierType]), [['211014180012', 'gador.com.uy', 'RUT']]);
    assert.equal(recorded.length, 0);
    assert.match(outcome.relationships[0].evidence, /medicamentos y antisépticos de uso humano/);
    assert.equal(outcome.relationships[0].evidenceUrl, 'https://www.comprasestatales.gub.uy/Resoluciones/acta_1240244.pdf');
  });
});

describe('5. Catálogo de fuentes', () => {
  it('connected_free_discovery, pendiente de validar, compras públicas', () => {
    assert.equal(UY_ARCE_AWARDS_CATALOG_SOURCE.key, UY_COUNTRY.sourceKey);
    assert.equal(UY_ARCE_AWARDS_CATALOG_SOURCE.aiFlowStatus, 'connected_free_discovery');
    assert.equal(UY_ARCE_AWARDS_CATALOG_SOURCE.operationalStatus, 'pending_validation');
    assert.equal(UY_ARCE_AWARDS_CATALOG_SOURCE.type, 'procurement');
  });
});
