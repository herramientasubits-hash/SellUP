/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 22 — la matriz de la fuente
 * gratuita, ejecutada sobre el orquestador real con adapters y detectores dobles.
 *
 * 🔴 Cero llamadas externas: los dobles son funciones locales. § 27 prohíbe
 * llamadas en vivo a Socrata/RUES o a cualquier proveedor durante este trabajo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import { buildCoSiisDiscoveryAdapter, type CoSiisSnapshotRow } from '../co-siis-discovery-adapter';
import type { CountrySourceAdapter } from '../country-source-types';

const MACRO = 'health_pharma';

/** Fila sintética. Nunca un nombre de empresa real (§ 21). */
function row(overrides: Partial<CoSiisSnapshotRow> & { record_identity_key: string }): CoSiisSnapshotRow {
  return {
    legal_name: `EMPRESA SINTETICA ${overrides.record_identity_key}`,
    normalized_legal_name: `empresa sintetica ${overrides.record_identity_key}`,
    tax_id: `9000000${overrides.record_identity_key}`,
    sector: 'SERVICIOS',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    // 2100 = «Fabricación de productos farmacéuticos» en la tabla CIIU del repo.
    ciiu: '2100',
    ...overrides,
  };
}

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 0,
    input,
    matches: [],
    summary: 'no_match',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function sellupExact(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    ...noMatch(input),
    status: 'existing_in_sellup',
    matches: [
      { source: 'sellup', status: 'existing_in_sellup', confidence: 100, reason: 'tax_identifier' },
    ],
  };
}

function hubspotExact(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    ...noMatch(input),
    status: 'existing_in_hubspot',
    matches: [
      { source: 'hubspot', status: 'existing_in_hubspot', confidence: 100, reason: 'nit' },
    ],
  };
}

function gate(
  rows: CoSiisSnapshotRow[],
  checker: (input: DuplicateCheckInput) => DuplicateCheckResult,
  opts: { requestedTarget?: number; macroIndustryKey?: string; countryCode?: string } = {},
) {
  return runPrePaidNoveltyGate(
    {
      provider: 'lusha',
      countryCode: opts.countryCode ?? 'CO',
      macroIndustryKey: opts.macroIndustryKey ?? MACRO,
      requestedTarget: opts.requestedTarget ?? 5,
    },
    {
      countrySourceAdapter: buildCoSiisDiscoveryAdapter(async () => rows),
      checkCompanyDuplicate: async (input) => checker(input),
      listKnownExclusionDomains: async () => ['https://Conocida.com/x', 'conocida.com', null],
    },
  );
}

test('§ 22(A) SOURCE SUFFICIENT — 5 nuevas confirmadas ⇒ hueco 0 y el proveedor NO es necesario', async () => {
  const rows = ['1', '2', '3', '4', '5'].map((k) => row({ record_identity_key: k }));
  const result = await gate(rows, noMatch);

  assert.equal(result.context.freeSource.macroConfirmed, 5);
  assert.equal(result.context.acceptedBeforeProvider, 5);
  assert.equal(result.context.residualGap, 0);
  assert.equal(result.context.providerRequired, false);
  assert.equal(result.acceptedCompanies.length, 5);
  // Sin proveedor no se construye lista de conocidos: sería una lectura para nadie.
  assert.deepEqual([...result.context.knownSuppressionDomains], []);
});

test('§ 22(B) SOURCE PARTIAL — 2 nuevas de 5 ⇒ el proveedor recibe hueco 3', async () => {
  const rows = ['1', '2', '3'].map((k) => row({ record_identity_key: k }));
  let calls = 0;
  const result = await gate(rows, (input) => {
    calls++;
    return calls <= 1 ? sellupExact(input) : noMatch(input);
  });

  assert.equal(result.context.freeSource.macroConfirmed, 3);
  assert.equal(result.context.freeSource.sellupKnown, 1);
  assert.equal(result.context.acceptedBeforeProvider, 2);
  assert.equal(result.context.residualGap, 3);
  assert.equal(result.context.providerRequired, true);
});

test('§ 22(C) SOURCE ALL KNOWN — todo conocido ⇒ hueco entero y respaldo de pago intacto', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ record_identity_key: `k${i}` }));
  let calls = 0;
  const result = await gate(rows, (input) => {
    calls++;
    return calls % 2 === 0 ? hubspotExact(input) : sellupExact(input);
  });

  assert.equal(result.context.freeSource.acceptedNovel, 0);
  assert.ok(result.context.freeSource.sellupKnown > 0);
  assert.ok(result.context.freeSource.hubspotKnown > 0);
  assert.equal(result.context.residualGap, 5);
  assert.equal(result.context.providerRequired, true);
});

test('§ 22(D) SOURCE OFF-MACRO — industria declarada de otra macro NO reduce el hueco', async () => {
  // 4111 = «Construcción de edificios residenciales».
  const rows = ['1', '2', '3'].map((k) => row({ record_identity_key: k, ciiu: '4111' }));
  const result = await gate(rows, noMatch);

  assert.equal(result.context.freeSource.macroConfirmed, 0);
  assert.equal(result.context.freeSource.rejected, 3);
  assert.equal(result.context.residualGap, 5);
  assert.equal(result.context.providerRequired, true);
});

test('§ 22(E) SOURCE AMBIGUOUS — sin industria declarada resoluble NO se confirma nada', async () => {
  // Un código que la tabla CIIU no contiene: sin descripción exacta no hay
  // industria declarada, y la ausencia jamás confirma.
  const rows = ['1', '2'].map((k) => row({ record_identity_key: k, ciiu: '9999' }));
  const result = await gate(rows, noMatch);

  assert.equal(result.context.freeSource.macroConfirmed, 0);
  assert.equal(result.context.freeSource.ambiguous, 2);
  assert.equal(result.context.residualGap, 5);
});

test('§ 22(F) SOURCE FAILURE — el adapter lanza ⇒ fail-open sin conteos inventados', async () => {
  const explode: CountrySourceAdapter = async () => {
    throw new Error('boom');
  };
  const result = await runPrePaidNoveltyGate(
    { provider: 'lusha', countryCode: 'CO', macroIndustryKey: MACRO, requestedTarget: 5 },
    { countrySourceAdapter: explode, checkCompanyDuplicate: async (i) => noMatch(i) },
  );

  assert.equal(result.context.freeSource.failed, true);
  assert.equal(result.context.freeSource.failureCode, 'source_unavailable');
  assert.equal(result.context.freeSource.acceptedNovel, 0);
  assert.equal(result.context.residualGap, 5);
  assert.equal(result.context.providerRequired, true);
});

test('§ 22(G) COUNTRY WITHOUT SOURCE — la ruta de pago queda intacta y nada se marca intentado', async () => {
  const result = await runPrePaidNoveltyGate(
    { provider: 'lusha', countryCode: 'MX', macroIndustryKey: MACRO, requestedTarget: 5 },
    {
      countrySourceAdapter: buildCoSiisDiscoveryAdapter(async () => [row({ record_identity_key: '1' })]),
      checkCompanyDuplicate: async (i) => noMatch(i),
    },
  );

  assert.equal(result.context.freeSource.attempted, false);
  assert.equal(result.context.freeSource.failureCode, 'country_without_source');
  assert.equal(result.context.residualGap, 5);
});

test('§ 22(H) · CUT-L1 — con proveedor por delante, los conocidos se RECOGEN normalizados y deduplicados', async () => {
  const rows = ['1'].map((k) => row({ record_identity_key: k }));
  const result = await gate(rows, (i) => sellupExact(i));

  assert.equal(result.context.providerRequired, true);
  // 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 1, 3 — se RECOGEN, no se
  // envían: Lusha V3 no tiene exclusión server-side (contrato HUMANO). Antes esta
  // prueba se llamaba «los conocidos VIAJAN» y leía `exclusionDomains`; el hecho
  // que defiende sigue vivo —la normalización y el dedupe— y su destino cambió.
  assert.deepEqual([...result.context.knownSuppressionDomains], ['conocida.com']);
  assert.equal(result.exclusionPlan.available, 1);
  assert.deepEqual([...result.exclusionPlan.availableValues], ['conocida.com']);
  assert.equal(result.exclusionPlan.omittedDueToCap, 0);
  // 🔴 Y NADA viaja: el plan lo dice y dice por qué.
  assert.deepEqual([...result.exclusionPlan.sent], []);
  assert.equal(
    result.providerExclusionPlan.domains.unsupportedReason,
    'lusha_v3_no_server_side_exclusion_human_confirmed',
  );
});

test('§ 22(I) NO WEBSITE — la empresa se evalúa por identidad legal y NO aporta dominio inventado', async () => {
  const rows = ['1', '2'].map((k) => row({ record_identity_key: k }));
  const seen: DuplicateCheckInput[] = [];
  const result = await gate(rows, (input) => {
    seen.push(input);
    return noMatch(input);
  });

  assert.equal(result.context.freeSource.acceptedNovel, 2);
  for (const input of seen) {
    assert.equal(input.domain, null, 'no se fabrica dominio');
    assert.equal(input.website, null, 'no se fabrica web');
    // La identidad que SÍ viaja es la fiscal, que es fuerte.
    assert.ok(input.taxIdentifier && input.taxIdentifier.length > 0);
    assert.ok(input.normalizedName && input.normalizedName.length > 0);
  }
  // Y ninguna aporta dominio a la supresión: la lista es EXACTAMENTE la de los
  // conocidos de SellUp, sin una sola entrada procedente de la fuente gratuita.
  //
  // 🔴 CUT-L1 § 3 — se afirma sobre `availableValues` porque `sent` está vacío por
  // capacidad; afirmarlo ahí pasaría por verde con la lista vacía y dejaría de
  // detectar un dominio fabricado, que es justo lo que este caso vigila.
  assert.deepEqual([...result.exclusionPlan.availableValues], ['conocida.com']);
});

test('§ 4 — una macro SIN cobertura de códigos no consulta la fuente: devuelve cero, no una muestra genérica', async () => {
  let queried = 0;
  const result = await runPrePaidNoveltyGate(
    { provider: 'lusha', countryCode: 'CO', macroIndustryKey: 'retail', requestedTarget: 5 },
    {
      countrySourceAdapter: buildCoSiisDiscoveryAdapter(async () => {
        queried++;
        return [row({ record_identity_key: '1', ciiu: '4111' })];
      }),
      checkCompanyDuplicate: async (i) => noMatch(i),
    },
  );

  assert.equal(queried, 0, 'no se consulta sin códigos que preguntar');
  assert.equal(result.context.freeSource.failureCode, 'source_not_criteria_aware');
  assert.equal(result.context.residualGap, 5);
});

test('§ 14 — la fuente nunca acepta por encima del objetivo, y deja de preguntar cuando se llena', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => row({ record_identity_key: `n${i}` }));
  let checks = 0;
  const result = await gate(rows, (input) => {
    checks++;
    return noMatch(input);
  }, { requestedTarget: 3 });

  assert.equal(result.context.acceptedBeforeProvider, 3);
  assert.equal(result.context.residualGap, 0);
  // 🔴 El objetivo se comprueba ANTES de preguntar por duplicados: HubSpot es red.
  assert.equal(checks, 3, 'no se consulta HubSpot por empresas que ya no caben');
});

test('la misma empresa repetida en la fuente cuenta UNA vez', async () => {
  const rows = [
    row({ record_identity_key: 'a', tax_id: '900111222' }),
    row({ record_identity_key: 'b', tax_id: '900111222' }),
  ];
  const result = await gate(rows, noMatch);
  assert.equal(result.context.freeSource.acceptedNovel, 1);
});
