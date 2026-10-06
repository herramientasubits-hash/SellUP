/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 6 · SOURCES-CO-CLOSE-1 — la
 * proyección de descubrimiento de Colombia es CONSCIENTE DE CRITERIOS: industria
 * por la tabla aprobada, web cargada, nada ya visto y Gobierno desde el
 * directorio de entidades públicas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoSiisDiscoveryAdapter,
  CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS,
  CO_SIIS_DISCOVERY_MAX_ROWS,
  CO_SIIS_DISCOVERY_SOURCE_KEY,
  isRecycledCoCompany,
  type CoSiisSnapshotRow,
} from '../co-siis-discovery-adapter';
import { CO_SIIS_MACRO_TABLE_VERSION, listCoCiiuCodesForMacro } from '../co-siis-macro-table';
import {
  assessCountrySourceMacroPrecision,
  isCountrySourceMacroPrecisionAdmitted,
} from '../country-source-macro-precision';
import { countrySourceMacroHasCoverage } from '../country-source-capability';

function row(overrides: Partial<CoSiisSnapshotRow> = {}): CoSiisSnapshotRow {
  return {
    record_identity_key: 'tax:900000001',
    legal_name: 'SINTETICA UNO S.A.S.',
    normalized_legal_name: 'sintetica uno',
    tax_id: '900000001',
    sector: 'SERVICIOS',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    ciiu: '2100',
    ...overrides,
  };
}

function entity(overrides: Partial<CoSiisSnapshotRow> = {}): CoSiisSnapshotRow {
  return {
    record_identity_key: 'tax:800099095',
    legal_name: 'Ipiales',
    normalized_legal_name: 'IPIALES',
    tax_id: '800099095',
    sector: 'Alcaldía',
    city: 'IPIALES',
    department: 'NARIÑO',
    ciiu: null,
    website_domain: 'ipiales-narino.gov.co',
    origin: 'public_entity',
    macro_industry_key: 'government',
    workers: 412,
    ...overrides,
  };
}

test('§ 4 — la consulta recibe los códigos CIIU de la tabla aprobada para la macro pedida', async () => {
  let received: readonly string[] = [];
  let receivedMacro = '';
  const adapter = buildCoSiisDiscoveryAdapter(async ({ ciiuCodes, macroIndustryKey }) => {
    received = ciiuCodes;
    receivedMacro = macroIndustryKey;
    return [row()];
  });

  await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 10 });
  assert.deepEqual([...received], [...listCoCiiuCodesForMacro('health_pharma')]);
  assert.equal(receivedMacro, 'health_pharma');
  assert.ok(received.includes('2100'));
});

test('SOURCES-CO-CLOSE-1 — Tecnología, Retail y Consumo masivo YA tienen códigos (antes 0)', () => {
  for (const macro of ['technology', 'retail', 'consumer_goods']) {
    assert.ok(listCoCiiuCodesForMacro(macro).length > 0, macro);
    assert.equal(countrySourceMacroHasCoverage('CO', macro), true, macro);
  }
  assert.ok(listCoCiiuCodesForMacro('technology').includes('6201'));
  assert.equal(countrySourceMacroHasCoverage('CO', 'government'), true);
});

test('§ 4 — una macro SIN códigos ni directorio no consulta nada: fail-closed', async () => {
  let queried = 0;
  const adapter = buildCoSiisDiscoveryAdapter(async () => {
    queried++;
    return [row()];
  });

  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'macro_inexistente', limit: 10 });
  assert.equal(queried, 0);
  assert.deepEqual([...result.companies], []);
  assert.equal(result.recordsRead, 0);
});

test('la lectura está acotada por un techo duro propio', async () => {
  let requestedLimit = 0;
  const adapter = buildCoSiisDiscoveryAdapter(async ({ limit }) => {
    requestedLimit = limit;
    return [];
  });

  await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 100_000 });
  assert.equal(requestedLimit, CO_SIIS_DISCOVERY_MAX_ROWS);
});

test('la web cargada viaja como dominio; sin web cargada, no se fabrica ninguna', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [
    row({ website_domain: 'Sintetica.com.co ' }),
    row({ record_identity_key: 'tax:900000002', tax_id: '900000002' }),
    row({ record_identity_key: 'tax:900000003', tax_id: '900000003', website_domain: 'no es un dominio' }),
  ]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });

  assert.deepEqual(result.companies.map((c) => c.domain), ['sintetica.com.co', null, null]);
  assert.equal(result.companies[0]?.taxIdentifierType, 'NIT');
  assert.equal(result.sourceKey, CO_SIIS_DISCOVERY_SOURCE_KEY);
});

test('la industria la decide la tabla de HOY: un código de otra macro no se ofrece', async () => {
  // 4791 «Comercio al por menor por correo y por internet» es Retail, nunca Tecnología
  // (el falso positivo del 01-09 con «internet»).
  const adapter = buildCoSiisDiscoveryAdapter(async () => [row({ ciiu: '4791' }), row({ ciiu: '6201', tax_id: '900000002' })]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 5 });

  assert.deepEqual(result.companies.map((c) => c.industryCode), ['6201']);
  assert.deepEqual(result.companies[0]?.officialMacroIndustry, {
    macroIndustryKeys: ['technology'],
    tableVersion: CO_SIIS_MACRO_TABLE_VERSION,
  });
  const precision = assessCountrySourceMacroPrecision({ macroIndustryKey: 'technology', company: result.companies[0]! });
  assert.equal(isCountrySourceMacroPrecisionAdmitted(precision), true);
});

test('el sector grueso se conserva como metadato, separado de la industria declarada', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [row({ sector: 'MANUFACTURA' })]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });
  assert.equal(result.companies[0]?.coarseSector, 'MANUFACTURA');
  assert.equal(result.companies[0]?.declaredIndustry, 'Fabricación de productos farmacéuticos');
});

test('una fila sin nombre legal o sin NIT de persona jurídica no puede ser candidata', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [
    row({ legal_name: null }),
    row({ tax_id: '12345' }),
    row(),
  ]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });
  assert.equal(result.companies.length, 1);
  assert.equal(result.recordsRead, 3);
});

test('SOURCES-CO-CLOSE-1 — no se repite lo ya visto; un descarte sin web vuelve si ahora la tiene', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [
    row({ tax_id: '900000001', prior_sighting: 'candidate' }),
    row({ tax_id: '900000002', prior_sighting: 'definitive_discard', website_domain: 'b.com.co' }),
    row({ tax_id: '900000003', prior_sighting: 'discard' }),
    row({ tax_id: '900000004', prior_sighting: 'discard', website_domain: 'd.com.co' }),
    row({ tax_id: '900000005' }),
  ]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });
  assert.deepEqual(result.companies.map((c) => c.taxId), ['900000004', '900000005']);

  assert.equal(isRecycledCoCompany({ prior_sighting: null, website_domain: null }), false);
});

test('un NIT, una empresa, y el tope pedido corta la lectura de más', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [
    row({ tax_id: '900000001' }),
    row({ tax_id: '900000001', record_identity_key: 'otra' }),
    row({ tax_id: '900000002' }),
    row({ tax_id: '900000003' }),
  ]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 2 });
  assert.deepEqual(result.companies.map((c) => c.taxId), ['900000001', '900000002']);
});

test('Gobierno: sólo entidades públicas de esa macro y con 200 servidores o más', async () => {
  let receivedCodes: readonly string[] = ['x'];
  const adapter = buildCoSiisDiscoveryAdapter(async ({ ciiuCodes }) => {
    receivedCodes = ciiuCodes;
    return [
      entity(),
      entity({ tax_id: '800000002', workers: CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS - 1 }),
      entity({ tax_id: '800000003', workers: null }),
      entity({ tax_id: '800000004', macro_industry_key: 'health_pharma' }),
    ];
  });
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'government', limit: 5 });

  assert.deepEqual([...receivedCodes], []);
  assert.deepEqual(result.companies.map((c) => c.taxId), ['800099095']);
  assert.equal(result.companies[0]?.domain, 'ipiales-narino.gov.co');
  const precision = assessCountrySourceMacroPrecision({ macroIndustryKey: 'government', company: result.companies[0]! });
  assert.equal(isCountrySourceMacroPrecisionAdmitted(precision), true);
});
