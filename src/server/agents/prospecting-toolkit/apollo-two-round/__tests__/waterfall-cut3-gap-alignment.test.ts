/**
 * waterfall-cut3-gap-alignment.test.ts
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 3 — la utilidad y el hueco son UNA sola
 * cuenta, y la ronda 2 nunca empieza de cero.
 *
 * ── 🔴 El defecto que cierra ─────────────────────────────────────────────────
 *
 * La demanda de cada ronda tenía dos ramas y sólo una descontaba lo ya
 * conseguido:
 *
 *   remainingTargetApplied !== null → hueco real
 *   remainingTargetApplied === null → `config.maxResultsPerRound` FIJO
 *
 * En la segunda rama —una corrida sin aporte de la capa gratuita, que es el caso
 * corriente— la ronda 2 volvía a apuntar al volumen entero de ronda como si la
 * ronda 1 no hubiera aportado nada. Con objetivo 5 y 3 útiles en la ronda 1, la
 * ronda 2 pedía 5 en vez de las 2 que faltaban.
 *
 * ── 🔴 UNA sola definición de "útil" ─────────────────────────────────────────
 *
 * El mismo número decide las cuatro preguntas: si la ronda 1 basta, si se hace
 * la ronda 2, cuánto pide la ronda 2 y si la corrida terminó. Ese número es
 * `stableFinalizableCandidateCount()` — fail-closed, la misma población que
 * puede terminar como candidato revisable— y NO un contador histórico de
 * net-new ni de resultados crudos.
 *
 * Casos obligatorios del producto (T = 5), en su forma Apollo-only; la pierna
 * Lusha se prueba en el corte 4:
 *   A · R1 = 5           ⇒ FIN, 0 rondas 2.
 *   B · R1 = 3, R2 = 2   ⇒ FIN con el objetivo cubierto.
 *   C · R1 = 3, R2 = 1   ⇒ termina en 4: queda hueco 1.
 *   D · R1 = 0, R2 = 4   ⇒ termina en 4: queda hueco 1.
 *   E · R1 = 8           ⇒ FIN inmediato, sin ronda 2.
 *   F · R1/R2 repetidos  ⇒ dedupe: lo repetido no vuelve a contar.
 *
 * 🔴 Ninguno de estos números es `per_page`: el body sale siempre con
 * `APOLLO_CONTRACT_MAX_PER_PAGE` (100).
 *
 * Offline por construcción. 0 llamadas reales · 0 créditos · 0 red · 0 Producción.
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
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';
import { WIZARD_TARGET_USEFUL_COMPANIES } from '@/modules/prospect-batches/wizard-target-authority';

const TARGET = WIZARD_TARGET_USEFUL_COMPANIES;

type SearchCall = { roundNumber: number; requestedResultLimit: number };

/**
 * Arnés donde la UTILIDAD es explícita: cada ronda declara cuántas de sus
 * organizaciones superan los gates. El resto se rechaza por un gate barato real.
 */
function harness(options: { usefulPerRound: number[]; returnedPerRound?: number[] }): {
  deps: ApolloTwoRoundDeps;
  searchCalls: SearchCall[];
} {
  const searchCalls: SearchCall[] = [];
  const usefulIds = new Set<string>();

  const roundResults = options.usefulPerRound.map((useful, index) => {
    const returned = options.returnedPerRound?.[index] ?? Math.max(useful, 10);
    const prefix = String.fromCharCode(97 + index);
    const organizations = orgs(prefix, returned);
    for (const organization of organizations.slice(0, useful)) {
      usefulIds.add(organization.providerOrganizationId ?? '');
    }
    return organizations;
  });

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber, requestedResultLimit }): Promise<RoundSearchOutcome> => {
      searchCalls.push({ roundNumber, requestedResultLimit });
      return {
        organizations: roundResults[roundNumber - 1] ?? [],
        providerRequestCount: 1,
        internalRecordedCredits: 1,
      };
    },
    assessCandidate: ({ organization }): CheapAssessment =>
      usefulIds.has(organization.providerOrganizationId ?? '')
        ? passingAssessment()
        : rejectedAssessment('sector_evidence_contradictory'),
    enrichCandidate: async () => ({
      executed: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 1,
    }),
  };

  return { deps, searchCalls };
}

/** Arnés con organizaciones REPETIDAS entre rondas (caso F). */
function repeatingHarness(page: RawDiscoveredOrganization[]): {
  deps: ApolloTwoRoundDeps;
  searchCalls: SearchCall[];
} {
  const searchCalls: SearchCall[] = [];
  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber, requestedResultLimit }): Promise<RoundSearchOutcome> => {
      searchCalls.push({ roundNumber, requestedResultLimit });
      return { organizations: page, providerRequestCount: 1, internalRecordedCredits: 1 };
    },
    assessCandidate: () => passingAssessment(),
    enrichCandidate: async () => ({
      executed: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 1,
    }),
  };
  return { deps, searchCalls };
}

function run(deps: ApolloTwoRoundDeps, remainingTarget: number | null = null) {
  return runApolloTwoRoundDiscovery(
    {
      // Techo por ronda deliberadamente POR ENCIMA del objetivo: así se ve que
      // lo que gobierna la petición es el hueco y no el techo.
      config: testConfig({ targetEligibleCompanies: TARGET, maxResultsPerRound: TARGET * 2 }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      remainingTarget,
    },
    deps,
  );
}

// ── Casos obligatorios del producto ──────────────────────────────────────────

describe('CORTE 3 — casos obligatorios de suficiencia (T = 5)', () => {
  test('A — R1 = 5 útiles ⇒ FIN, sin ronda 2', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [5, 5] });

    const result = await run(deps);

    assert.equal(result.stableFinalizableCandidateCount, TARGET);
    assert.equal(result.roundsExecuted, 1);
    assert.equal(searchCalls.filter((call) => call.roundNumber === 2).length, 0);
    assert.equal(result.secondRoundSkippedReason, 'target_reached');
    assert.equal(result.targetReached, true);
  });

  test('B — R1 = 3, R2 = 2 ⇒ objetivo cubierto en dos rondas', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [3, 2] });

    const result = await run(deps);

    assert.equal(result.roundsExecuted, 2);
    assert.equal(result.stableFinalizableCandidateCount, TARGET);
    assert.equal(result.targetReached, true);
    // La ronda 2 pidió exactamente lo que faltaba: 5 − 3 = 2.
    assert.equal(searchCalls[1]!.requestedResultLimit, 2);
  });

  test('C — R1 = 3, R2 = 1 ⇒ termina en 4 y el hueco vivo es 1', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [3, 1] });

    const result = await run(deps);

    assert.equal(result.roundsExecuted, 2);
    assert.equal(result.stableFinalizableCandidateCount, 4);
    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
    assert.equal(searchCalls[1]!.requestedResultLimit, 2, 'la ronda 2 pidió el hueco de ese momento');
    assert.equal(
      TARGET - result.stableFinalizableCandidateCount,
      1,
      'el hueco que quedaría para una pierna siguiente',
    );
  });

  test('D — R1 = 0, R2 = 4 ⇒ termina en 4 y la ronda 2 pidió el objetivo entero', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [0, 4] });

    const result = await run(deps);

    assert.equal(result.roundsExecuted, 2);
    assert.equal(result.stableFinalizableCandidateCount, 4);
    assert.equal(result.targetReached, false);
    // Con 0 aportadas, el hueco ES el objetivo: aquí pedir 5 es correcto.
    assert.equal(searchCalls[1]!.requestedResultLimit, TARGET);
  });

  test('E — R1 = 8 útiles ⇒ FIN inmediato, sin ronda 2', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [8, 8] });

    const result = await run(deps);

    assert.equal(result.roundsExecuted, 1);
    assert.equal(searchCalls.length, 1);
    assert.equal(result.secondRoundSkippedReason, 'target_reached');
    assert.equal(result.targetReached, true);
    // Sobrarle empresas no le hace persistir más que el objetivo.
    assert.ok(
      result.persistedCandidates <= TARGET,
      `persistió ${result.persistedCandidates} con objetivo ${TARGET}`,
    );
  });

  test('F — R1 y R2 devuelven lo MISMO ⇒ lo repetido no vuelve a contar', async () => {
    // 3 útiles repetidas: nunca pueden sumar 6.
    const { deps } = repeatingHarness(orgs('dup', 3));

    const result = await run(deps);

    assert.equal(result.stableFinalizableCandidateCount, 3, 'tres organizaciones, tres empresas');
    assert.equal(result.targetReached, false);
    if (result.roundsExecuted === 2) {
      assert.equal(result.rounds[1]!.newUniqueResults, 0);
      assert.equal(result.rounds[1]!.seenDuplicates, 3);
    }
  });
});

// ── La ronda 2 nunca reinicia la cuenta ──────────────────────────────────────

describe('CORTE 3 — la ronda 2 pide el hueco, no el objetivo', () => {
  test('sin capa gratuita, la ronda 2 descuenta lo que aportó la ronda 1', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [3, 0] });

    await run(deps, null);

    assert.equal(searchCalls[0]!.requestedResultLimit, TARGET, 'la ronda 1 apunta al objetivo');
    assert.equal(searchCalls[1]!.requestedResultLimit, 2, 'la ronda 2 apunta al hueco');
    assert.notEqual(
      searchCalls[1]!.requestedResultLimit,
      TARGET,
      'la ronda 2 no puede reiniciarse al objetivo entero',
    );
  });

  test('con capa gratuita el hueco de entrada también se descuenta', async () => {
    // Hueco de entrada 3 (la capa gratuita cerró 2), y la ronda 1 aporta 1.
    const { deps, searchCalls } = harness({ usefulPerRound: [1, 0] });

    const result = await run(deps, 3);

    assert.equal(result.targetEligibleCompanies, 3, 'el objetivo efectivo es el hueco de entrada');
    assert.equal(searchCalls[0]!.requestedResultLimit, 3);
    assert.equal(searchCalls[1]!.requestedResultLimit, 2, '3 de entrada − 1 de la ronda 1');
  });

  test('ninguna ronda pide más que el techo por ronda', async () => {
    const { deps, searchCalls } = harness({ usefulPerRound: [0, 0] });

    await run(deps, null);

    for (const call of searchCalls) {
      assert.ok(
        call.requestedResultLimit <= TARGET * 2,
        `la ronda ${call.roundNumber} pidió ${call.requestedResultLimit}`,
      );
      assert.ok(call.requestedResultLimit >= 1, 'una ronda autorizada nunca pide 0');
    }
  });
});

// ── Una sola definición de útil ──────────────────────────────────────────────

describe('CORTE 3 — la misma cuenta decide parar, pedir y terminar', () => {
  test('el hueco es objetivo − ESTABLES, no objetivo − crudos ni − net-new', async () => {
    // 40 crudos devueltos, 30 net-new tras dedupe, 2 realmente útiles.
    const { deps, searchCalls } = harness({ usefulPerRound: [2, 0], returnedPerRound: [40, 40] });

    const result = await run(deps, null);

    assert.equal(result.stableFinalizableCandidateCount, 2);
    assert.equal(
      searchCalls[1]!.requestedResultLimit,
      3,
      'el hueco descuenta las ÚTILES (2), no los 40 resultados crudos',
    );
    assert.ok(result.rounds[0]!.normalizedResults >= 40, 'los 40 se evaluaron (corte 2)');
  });

  test('la parada y el resultado final leen la MISMA cuenta', async () => {
    const { deps } = harness({ usefulPerRound: [TARGET, 0] });

    const result = await run(deps);

    assert.equal(result.secondRoundSkippedReason, 'target_reached');
    assert.equal(result.targetReached, true);
    assert.equal(result.stableFinalizableCandidateCount >= result.targetEligibleCompanies, true);
  });
});
