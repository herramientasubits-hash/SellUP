/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 6 — la proyección de
 * descubrimiento sobre el snapshot co_siis es CONSCIENTE DE CRITERIOS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoSiisDiscoveryAdapter,
  CO_SIIS_DISCOVERY_MAX_ROWS,
  CO_SIIS_DISCOVERY_SOURCE_KEY,
  type CoSiisSnapshotRow,
} from '../co-siis-discovery-adapter';
import { resolveMacroCiiuCodes } from '../macro-ciiu-index';

function row(overrides: Partial<CoSiisSnapshotRow> = {}): CoSiisSnapshotRow {
  return {
    record_identity_key: 'r1',
    legal_name: 'SINTETICA UNO',
    normalized_legal_name: 'sintetica uno',
    tax_id: '900000001',
    sector: 'SERVICIOS',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    ciiu: '2100',
    ...overrides,
  };
}

test('§ 4 — la consulta recibe los códigos CIIU de la macro pedida, no una muestra libre', async () => {
  let received: readonly string[] = [];
  const adapter = buildCoSiisDiscoveryAdapter(async ({ ciiuCodes }) => {
    received = ciiuCodes;
    return [row()];
  });

  await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 10 });
  assert.deepEqual([...received], [...resolveMacroCiiuCodes('health_pharma')]);
  assert.ok(received.length > 0);
});

test('§ 4 — una macro SIN códigos no consulta nada: fail-closed, no muestra genérica', async () => {
  let queried = 0;
  const adapter = buildCoSiisDiscoveryAdapter(async () => {
    queried++;
    return [row()];
  });

  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'retail', limit: 10 });
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

test('§ 22(I) — la proyección NO fabrica dominio: co_siis no publica web', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [row()]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });

  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0]?.domain, null);
  assert.equal(result.companies[0]?.taxIdentifierType, 'NIT');
  assert.equal(result.sourceKey, CO_SIIS_DISCOVERY_SOURCE_KEY);
});

test('un CIIU desconocido deja la industria declarada en null (la ausencia no confirma)', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [row({ ciiu: '9999' })]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });
  assert.equal(result.companies[0]?.declaredIndustry, null);
});

test('el sector grueso se conserva como metadato, separado de la industria declarada', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [row({ sector: 'MANUFACTURA' })]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });
  const company = result.companies[0];

  assert.equal(company?.coarseSector, 'MANUFACTURA');
  // 🔴 Y NO se cuela en la industria declarada, que es lo único que evalúa el
  // catálogo canónico. Mezclarlas repetiría el defecto de #306.
  assert.equal(company?.declaredIndustry, 'Fabricación de productos farmacéuticos');
});

test('una fila sin nombre legal no puede ser candidata', async () => {
  const adapter = buildCoSiisDiscoveryAdapter(async () => [row({ legal_name: null }), row()]);
  const result = await adapter({ countryCode: 'CO', macroIndustryKey: 'health_pharma', limit: 5 });
  assert.equal(result.companies.length, 1);
  // `recordsRead` sigue contando lo LEÍDO, no lo aceptado.
  assert.equal(result.recordsRead, 2);
});
