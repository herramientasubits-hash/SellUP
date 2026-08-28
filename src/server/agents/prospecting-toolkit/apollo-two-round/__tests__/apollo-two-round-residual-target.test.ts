/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 4, 6, 7, 13, 14 — la demanda residual
 * dentro del orquestador de dos rondas.
 *
 * El defecto que cierra: la modalidad pedía `config.maxResultsPerRound` en cada
 * ronda y se paraba en `config.targetEligibleCompanies`, ignorando por completo
 * cuántas empresas la capa gratuita ya había cerrado. Con objetivo 10, 7 cerradas
 * gratis y hueco 3, Apollo seguía buscando cinco por ronda hasta acumular cinco.
 *
 * 🔴 Lo que NO puede pasar y estas pruebas vigilan:
 *   · que la ronda 2 se reinicie al hueco original en vez de descontar lo que la
 *     ronda 1 aportó (§ 7);
 *   · que la cota pueda AMPLIAR el techo configurado;
 *   · que la demanda toque el peor caso económico (§ 5) — eso lo prueba, aparte,
 *     la suite de ratchets estáticos, porque aquí el presupuesto ni siquiera se
 *     construye.
 *
 * Offline por construcción: proveedor, gates y enrichment son funciones
 * inyectadas. LIVE_APOLLO_CALLS = 0, APOLLO_CREDITS_USED = 0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
} from '../orchestrator';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  orgs,
  passingAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';

// ─── Arnés ────────────────────────────────────────────────────────────────────

type SearchCall = { roundNumber: number; requestedResultLimit: number };

function harness(options: {
  roundResults: RawDiscoveredOrganization[][];
  assess?: (organization: RawDiscoveredOrganization, roundNumber: number) => CheapAssessment;
}): { deps: ApolloTwoRoundDeps; searchCalls: SearchCall[] } {
  const searchCalls: SearchCall[] = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber, requestedResultLimit }): Promise<RoundSearchOutcome> => {
      searchCalls.push({ roundNumber, requestedResultLimit });
      const organizations = options.roundResults[roundNumber - 1] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
      };
    },
    assessCandidate: ({ organization, roundNumber }) =>
      options.assess?.(organization, roundNumber) ?? passingAssessment(),
    enrichCandidate: async () => ({
      executed: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 1,
    }),
  };

  return { deps, searchCalls };
}

function run(
  deps: ApolloTwoRoundDeps,
  remainingTarget: number | null,
  config = testConfig(),
) {
  return runApolloTwoRoundDiscovery(
    {
      config,
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      remainingTarget,
    },
    deps,
  );
}

// ─── § 13 · la demanda de resultados respeta el hueco ─────────────────────────

describe('CUT-2 § 13 · demanda residual', () => {
  test('A — objetivo 5, hueco 3 ⇒ ninguna ronda pide más de 3', async () => {
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 1), orgs('b', 1)] });

    const result = await run(deps, 3);

    assert.equal(result.targetEligibleCompanies, 3, 'el objetivo efectivo es el hueco');
    assert.equal(result.configuredTargetEligibleCompanies, 5, 'el de la config no se toca');
    assert.equal(result.remainingTargetApplied, 3);
    assert.ok(searchCalls.length > 0, 'hubo búsqueda');
    for (const call of searchCalls) {
      assert.ok(
        call.requestedResultLimit <= 3,
        `la ronda ${call.roundNumber} pidió ${call.requestedResultLimit} con hueco 3`,
      );
    }
  });

  test('B — hueco 0 ⇒ CERO llamadas al proveedor', async () => {
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 5), orgs('b', 5)] });

    const result = await run(deps, 0);

    assert.equal(searchCalls.length, 0, 'con el hueco cerrado no se emite ni una petición');
    assert.equal(result.targetEligibleCompanies, 0);
    assert.equal(result.roundsExecuted, 0);
    assert.equal(result.persistedCandidates, 0);
  });

  test('C — sin capa previa (`null`) el comportamiento es el anterior al corte', async () => {
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 2), orgs('b', 2)] });

    const result = await run(deps, null);

    assert.equal(result.targetEligibleCompanies, 5, 'gobierna el objetivo de la config');
    assert.equal(result.remainingTargetApplied, null);
    // El techo por ronda vuelve a ser `maxResultsPerRound`, byte por byte.
    for (const call of searchCalls) {
      assert.equal(call.requestedResultLimit, 5);
    }
  });

  test('D — hueco 1 ⇒ la petición efectiva es de 1 resultado', async () => {
    const { deps, searchCalls } = harness({ roundResults: [[], []] });

    await run(deps, 1);

    assert.ok(searchCalls.length >= 1);
    assert.equal(searchCalls[0]!.requestedResultLimit, 1);
    for (const call of searchCalls) {
      assert.equal(call.requestedResultLimit, 1);
    }
  });

  test('E — el proveedor devuelve MÁS de lo pedido: se acepta el objetivo, no se falsea', async () => {
    // Apollo puede devolver más filas que las pedidas. El corte 1 ya registra el
    // volumen REAL antes de cualquier recorte local (`paid_raw`); lo que aquí se
    // comprueba es que ese exceso no infle el objetivo de la corrida.
    const { deps } = harness({ roundResults: [orgs('a', 9), orgs('b', 9)] });

    const result = await run(deps, 2);

    assert.equal(result.targetEligibleCompanies, 2);
    // El ranking final recorta al objetivo efectivo: nueve devueltas no se
    // convierten en nueve candidatas persistidas.
    assert.ok(
      result.persisted.length <= 2,
      `se persistieron ${result.persisted.length} con hueco 2`,
    );
    assert.equal(result.targetReached, true);
    // Y la corrida NO declara haber buscado cinco: reporta el objetivo que gobernó.
    assert.equal(result.configuredTargetEligibleCompanies, 5);
  });

  test('🔴 la cota nunca AMPLÍA: hueco 9 sobre un techo de 5 sigue pidiendo 5', async () => {
    const { deps, searchCalls } = harness({ roundResults: [[], []] });

    const result = await run(deps, 9);

    assert.equal(result.targetEligibleCompanies, 5);
    for (const call of searchCalls) {
      assert.ok(call.requestedResultLimit <= 5);
    }
  });
});

// ─── § 14 · las dos rondas comparten UN hueco ─────────────────────────────────

describe('CUT-2 § 14 · un solo hueco para las dos rondas', () => {
  test('A — hueco 3, la ronda 1 aporta 2 ⇒ la ronda 2 pide como mucho 1', async () => {
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 2), orgs('b', 3)] });

    await run(deps, 3);

    const round2 = searchCalls.filter((c) => c.roundNumber === 2);
    assert.equal(round2.length, 1, 'la ronda 2 se ejecutó');
    assert.equal(
      round2[0]!.requestedResultLimit,
      1,
      '🔴 la ronda 2 NO puede reiniciarse al hueco original',
    );
  });

  test('B — la ronda 1 cierra el hueco ⇒ la ronda 2 no se ejecuta', async () => {
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 3), orgs('b', 3)] });

    const result = await run(deps, 3);

    assert.equal(searchCalls.filter((c) => c.roundNumber === 2).length, 0);
    assert.equal(result.secondRoundSkippedReason, 'target_reached');
    assert.equal(result.targetReached, true);
  });

  test('C — la ronda 1 aporta 0 ⇒ la ronda 2 puede usar el hueco entero', async () => {
    const { deps, searchCalls } = harness({ roundResults: [[], orgs('b', 3)] });

    await run(deps, 3);

    const round2 = searchCalls.filter((c) => c.roundNumber === 2);
    assert.equal(round2.length, 1);
    assert.equal(round2[0]!.requestedResultLimit, 3);
  });

  test('D — ninguna ronda pide más que el hueco ORIGINAL, y la 2 nunca más que el vigente', async () => {
    // El invariante es acumulativo en el sentido correcto: el hueco vigente sólo
    // decrece, así que cada ronda pide <= hueco vigente <= hueco original. NO es
    // que la suma de las dos rondas quepa en el hueco —el caso C lo desmiente y
    // debe hacerlo: una ronda 1 estéril no puede consumir el derecho a buscar.
    const original = 3;
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 1), orgs('b', 5)] });

    await run(deps, original);

    for (const call of searchCalls) {
      assert.ok(
        call.requestedResultLimit <= original,
        `la ronda ${call.roundNumber} pidió ${call.requestedResultLimit} > ${original}`,
      );
    }
    const round1 = searchCalls.find((c) => c.roundNumber === 1)!;
    const round2 = searchCalls.find((c) => c.roundNumber === 2)!;
    assert.equal(round1.requestedResultLimit, 3);
    // La ronda 1 aportó 1 ⇒ quedan 2.
    assert.equal(round2.requestedResultLimit, 2);
  });

  test('🔴 el suelo de la petición es 1: nunca se emite una página de cero', async () => {
    // Si el orquestador decidiera ejecutar una ronda, su petición tiene que poder
    // devolver algo. Un `per_page: 0` sería una llamada que se paga y no rinde.
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 1), orgs('b', 1)] });

    await run(deps, 1);

    for (const call of searchCalls) {
      assert.ok(call.requestedResultLimit >= 1);
    }
  });
});

// ─── AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING · PART A · escenarios C1-C4 ──────
//
// El tope local de `targetEligibleCompanies` subió de 5/6 a 10
// (WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES, ver config.ts). Estos casos
// prueban que la demanda residual del wizard llega HASTA 10 sin que ningún
// tope local por debajo de ese número la trunque, con la MISMA aritmética
// genérica (`boundByRemainingTarget` = `Math.min`) que la suite de arriba ya
// prueba a fondo con un techo de 5 — aquí sólo se confirma que generaliza al
// techo nuevo, no se reprueba la aritmética en sí.

function config10(overrides: Partial<ReturnType<typeof testConfig>> = {}) {
  return { ...testConfig(), targetEligibleCompanies: 10, maxResultsPerRound: 10, ...overrides };
}

describe('AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING § A · demanda hasta 10', () => {
  test('C1 — objetivo 10, hueco 10 (0 gratis): la demanda llega a 10, no se trunca en 5/6', async () => {
    const { deps, searchCalls } = harness({
      roundResults: [orgs('a', 6), orgs('b', 6)],
    });

    const result = await run(deps, 10, config10());

    assert.equal(result.targetEligibleCompanies, 10);
    assert.equal(result.configuredTargetEligibleCompanies, 10);
    assert.equal(result.remainingTargetApplied, 10);
    assert.equal(result.targetReached, true);
    assert.ok(result.persisted.length <= 10);
    // Ninguna ronda pide más de lo que hace falta (10), pero SÍ puede pedir
    // más de 5/6: esa era exactamente la truncación que este corte cierra.
    assert.ok(searchCalls.some((call) => call.requestedResultLimit > 6));
  });

  test('C2 — objetivo 10, hueco 9 (1 gratis)', async () => {
    const { deps } = harness({ roundResults: [orgs('a', 5), orgs('b', 5)] });

    const result = await run(deps, 9, config10());

    assert.equal(result.targetEligibleCompanies, 9);
    assert.equal(result.configuredTargetEligibleCompanies, 10);
    assert.ok(result.persisted.length <= 9);
  });

  test('C3 — objetivo 8 directo (sin capa gratuita recortando desde 10)', async () => {
    const { deps } = harness({ roundResults: [orgs('a', 4), orgs('b', 4)] });

    const result = await run(deps, 8, config10({ targetEligibleCompanies: 8 }));

    assert.equal(result.targetEligibleCompanies, 8);
    assert.equal(result.configuredTargetEligibleCompanies, 8);
    assert.ok(result.persisted.length <= 8);
  });

  test('C4 — objetivo 10, hueco 6 (4 gratis): sigue funcionando, sin regresión', async () => {
    const { deps } = harness({ roundResults: [orgs('a', 3), orgs('b', 3)] });

    const result = await run(deps, 6, config10());

    assert.equal(result.targetEligibleCompanies, 6);
    assert.equal(result.configuredTargetEligibleCompanies, 10);
    assert.ok(result.persisted.length <= 6);
  });

  test('el techo configurado (10) nunca se amplía aunque el hueco sea mayor', async () => {
    const { deps, searchCalls } = harness({ roundResults: [orgs('a', 20), orgs('b', 20)] });

    const result = await run(deps, 999, config10());

    assert.equal(result.targetEligibleCompanies, 10);
    for (const call of searchCalls) {
      assert.ok(call.requestedResultLimit <= 10);
    }
  });
});
