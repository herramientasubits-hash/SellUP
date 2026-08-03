/**
 * Dos rondas adaptativas — comportamiento y límites.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 13, casos 1–4 y 12–17.
 *
 * Offline por construcción: el proveedor, los gates y el enrichment son
 * funciones inyectadas. LIVE_APOLLO_CALLS = 0, APOLLO_CREDITS_USED = 0.
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
  org,
  orgs,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
} from './fixtures';

// ─── Arnés ────────────────────────────────────────────────────────────────────

type Recorder = {
  searchCalls: Array<{ roundNumber: number; requestedResultLimit: number; operationKey: string }>;
  enrichCalls: Array<{ candidateKey: string; roundNumber: number }>;
};

function harness(options: {
  roundResults: RawDiscoveredOrganization[][];
  assess?: (organization: RawDiscoveredOrganization, roundNumber: number) => CheapAssessment;
  enrichOutcome?: (candidateKey: string) => {
    sectorEvidenceState: CheapAssessment['sectorEvidenceState'];
  };
}): { deps: ApolloTwoRoundDeps; recorder: Recorder } {
  const recorder: Recorder = { searchCalls: [], enrichCalls: [] };

  const deps: ApolloTwoRoundDeps = {
    searchRound: async ({ roundNumber, requestedResultLimit, operationContext }): Promise<RoundSearchOutcome> => {
      recorder.searchCalls.push({
        roundNumber,
        requestedResultLimit,
        operationKey: operationContext.operationId,
      });
      const organizations = options.roundResults[roundNumber - 1] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        // 1 crédito por resultado devuelto: el modelo conservador del ledger.
        internalRecordedCredits: organizations.length,
      };
    },
    assessCandidate: ({ organization, roundNumber }) =>
      options.assess?.(organization, roundNumber) ?? passingAssessment(),
    enrichCandidate: async ({ candidateKey, roundNumber }) => {
      recorder.enrichCalls.push({ candidateKey, roundNumber });
      return {
        executed: true,
        sectorEvidenceState:
          options.enrichOutcome?.(candidateKey).sectorEvidenceState ??
          'sector_evidence_confirmed',
        internalRecordedCredits: 1,
      };
    },
  };

  return { deps, recorder };
}

function run(deps: ApolloTwoRoundDeps, config = testConfig()) {
  return runApolloTwoRoundDiscovery(
    { config, queryContext: testQueryContext(), correlation: testCorrelation() },
    deps,
  );
}

// ─── Casos 1–4: comportamiento de las dos rondas ─────────────────────────────

describe('§ 13 · dos rondas', () => {
  test('caso 1 — la ronda 1 encuentra cinco elegibles: una sola ronda, cero peticiones en la 2', async () => {
    const { deps, recorder } = harness({ roundResults: [orgs('a', 5), orgs('b', 5)] });

    const result = await run(deps);

    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.targetReached, true);
    assert.equal(result.resultStatus, 'target_reached');
    assert.equal(result.secondRoundSkippedReason, 'target_reached');
    assert.equal(recorder.searchCalls.filter((c) => c.roundNumber === 2).length, 0);
  });

  test('caso 2 — tres en la ronda 1 y dos nuevas en la ronda 2 completan el objetivo', async () => {
    const { deps, recorder } = harness({ roundResults: [orgs('a', 3), orgs('b', 2)] });

    const result = await run(deps);

    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.roundsExecuted, 2);
    assert.equal(result.targetReached, true);
    assert.equal(recorder.searchCalls.length, 2);
  });

  test('caso 3 — dos en la ronda 1 y cero en la 2 devuelven un parcial explícito', async () => {
    const { deps } = harness({ roundResults: [orgs('a', 2), []] });

    const result = await run(deps);

    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
    assert.equal(result.partialResultReason, 'partial_target_not_reached');
    assert.equal(result.targetEligibleCompanies, 5);
    assert.equal(result.eligibleCompaniesFound, 2);
    assert.equal(result.roundsExecuted, 2);
  });

  test('caso 4 — la ronda 2 repite organizaciones: ni una llamada duplicada ni un enrichment repetido', async () => {
    const repeated = orgs('a', 3);
    const { deps, recorder } = harness({
      // La ronda 2 devuelve EXACTAMENTE las mismas organizaciones.
      roundResults: [repeated, repeated],
      // Ambiguas para que compitan por enrichment si el dedup fallara.
      assess: () => ambiguousAssessment(),
    });

    const result = await run(deps);

    // Una petición por ronda: ninguna ronda se busca dos veces.
    const perRound = new Map<number, number>();
    for (const call of recorder.searchCalls) {
      perRound.set(call.roundNumber, (perRound.get(call.roundNumber) ?? 0) + 1);
    }
    assert.deepEqual([...perRound.values()], [1, 1]);

    // Ninguna organización se enriquece dos veces.
    const enrichedKeys = recorder.enrichCalls.map((c) => c.candidateKey);
    assert.equal(new Set(enrichedKeys).size, enrichedKeys.length);

    // Y ninguna de la ronda 2 llegó siquiera a evaluarse.
    assert.equal(result.rounds[1]?.seenDuplicates, 3);
    assert.equal(result.rounds[1]?.newEligibleCompaniesAdded, 0);
  });

  test('caso 9 — un Apollo ID repetido entre rondas se descarta antes de cualquier gate', async () => {
    const round1 = [org('shared', { providerRank: 1 })];
    // Mismo id de proveedor, distinto dominio y distinto nombre.
    const round2 = [
      org('shared', { providerRank: 1, domain: 'otro-dominio.com', name: 'Otra Razón Social' }),
      org('nueva', { providerRank: 2 }),
    ];
    const assessed: string[] = [];
    const { deps } = harness({
      roundResults: [round1, round2],
      assess: (organization) => {
        assessed.push(organization.providerOrganizationId ?? 'none');
        return passingAssessment();
      },
    });

    await run(deps);

    assert.equal(assessed.filter((id) => id === 'shared').length, 1);
    assert.ok(assessed.includes('nueva'));
  });
});

// ─── Casos 12–17: límites ─────────────────────────────────────────────────────

describe('§ 13 · límites', () => {
  test('caso 12 — como máximo dos búsquedas', async () => {
    const { deps, recorder } = harness({ roundResults: [orgs('a', 1), orgs('b', 1), orgs('c', 5)] });

    const result = await run(deps);

    assert.equal(recorder.searchCalls.length, 2);
    assert.equal(result.roundsExecuted, 2);
  });

  test('caso 13 — cada ronda pide como máximo cinco resultados', async () => {
    const { deps, recorder } = harness({ roundResults: [orgs('a', 1), orgs('b', 1)] });

    await run(deps);

    for (const call of recorder.searchCalls) {
      assert.equal(call.requestedResultLimit, 5);
    }
  });

  test('caso 14 — como máximo diez resultados crudos en total', async () => {
    // Ocho por ronda: el proveedor puede devolver de más; el tope es nuestro.
    const { deps } = harness({
      roundResults: [orgs('a', 8), orgs('b', 8)],
      assess: () => rejectedAssessment('sector_evidence_contradictory'),
    });

    const result = await run(deps);

    const processed = result.runMetrics.totalUniqueOrganizations;
    assert.ok(processed <= 10, `procesadas ${processed}, esperado ≤ 10`);
    assert.equal(processed, 10);
  });

  test('caso 15 — como máximo dos enrichments, y el cap es GLOBAL para ambas rondas', async () => {
    const { deps, recorder } = harness({
      // Muchas ambiguas en ambas rondas: sin cap global se pagarían 2 por ronda.
      roundResults: [orgs('a', 5), orgs('b', 5)],
      assess: () => ambiguousAssessment(),
      // El enrichment no confirma, así que nunca se alcanza el objetivo y la
      // corrida agota sus dos rondas.
      enrichOutcome: () => ({ sectorEvidenceState: 'sector_evidence_missing_needs_enrichment' }),
    });

    const result = await run(deps);

    assert.equal(recorder.enrichCalls.length, 2);
    assert.equal(result.runMetrics.enrichmentsExecuted, 2);
    assert.equal(result.roundsExecuted, 2);
  });

  test('caso 16 — parada inmediata al alcanzar cinco, sin gastar los enrichments restantes', async () => {
    const { deps, recorder } = harness({ roundResults: [orgs('a', 6)] });

    const result = await run(deps);

    assert.equal(result.roundsExecuted, 1);
    assert.equal(recorder.enrichCalls.length, 0);
    assert.equal(result.eligibleCompaniesFound, 6);
    assert.equal(result.persistedCandidates, 5);
  });

  test('caso 17 — nunca hay una tercera ronda, ni siquiera sin alcanzar el objetivo', async () => {
    const { deps, recorder } = harness({
      roundResults: [orgs('a', 1), orgs('b', 1), orgs('c', 5)],
    });

    const result = await run(deps);

    assert.equal(recorder.searchCalls.length, 2);
    assert.ok(!recorder.searchCalls.some((c) => c.roundNumber === 3));
    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
  });
});

// ─── § 9: acumulación y ranking final ─────────────────────────────────────────

describe('§ 9 · acumulación y tope de persistencia', () => {
  test('con más de cinco elegibles se conservan cinco y el resto queda registrado', async () => {
    const { deps } = harness({ roundResults: [orgs('a', 7)] });

    const result = await run(deps);

    assert.equal(result.eligibleCompaniesFound, 7);
    assert.equal(result.persistedCandidates, 5);
    assert.equal(result.notPersisted.length, 2);
    for (const entry of result.notPersisted) {
      assert.equal(entry.reason, 'eligible_not_persisted_due_to_target_cap');
    }
    // Las métricas de los elegibles adicionales NO se pierden.
    assert.equal(result.runMetrics.totalEligibleCompanies, 7);
  });

  test('el ranking final prefiere sector confirmado sobre evidencia ausente', async () => {
    const ambiguous = org('ambigua', { providerRank: 1 });
    const confirmed = org('confirmada', { providerRank: 2 });
    const { deps } = harness({
      roundResults: [[ambiguous, confirmed]],
      assess: (organization) =>
        organization.providerOrganizationId === 'ambigua'
          ? ambiguousAssessment()
          : passingAssessment(),
      // El enrichment confirma a la ambigua: ambas terminan elegibles.
      enrichOutcome: () => ({ sectorEvidenceState: 'sector_evidence_confirmed' }),
    });

    const result = await run(deps, testConfig({ targetEligibleCompanies: 1 }));

    assert.equal(result.persistedCandidates, 1);
    // La que llegó confirmada de fábrica gana: mismo estado sectorial, pero sin
    // haber costado un crédito de enrichment y con más señales gratuitas.
    assert.equal(result.persisted[0]?.candidateKey, 'apollo:confirmada');
  });
});

// ─── § 11: observabilidad ─────────────────────────────────────────────────────

describe('§ 11 · observabilidad', () => {
  test('el desperdicio de enrichment cuenta sólo lo pagado que terminó rechazado', async () => {
    const { deps } = harness({
      roundResults: [orgs('a', 2), []],
      assess: () => ambiguousAssessment(),
      // Se paga y sigue sin confirmarse: eso es desperdicio.
      enrichOutcome: () => ({ sectorEvidenceState: 'sector_evidence_missing_needs_enrichment' }),
    });

    const result = await run(deps);

    assert.equal(result.runMetrics.enrichmentsExecuted, 2);
    assert.equal(result.runMetrics.enrichmentWaste, 2);
    assert.equal(result.runMetrics.enrichmentWasteRate, 1);
  });

  test('el caso observado citi.com — enriquecido y luego deduplicado — cuenta como desperdicio', async () => {
    const citi = org('citi', { domain: 'citi.com', name: 'Citigroup Inc' });
    const { deps } = harness({
      roundResults: [[citi], []],
      assess: () => ambiguousAssessment(),
      enrichOutcome: () => ({ sectorEvidenceState: 'sector_evidence_contradictory' }),
    });

    const result = await run(deps);

    assert.equal(result.runMetrics.enrichmentWaste, 1);
    assert.equal(result.eligibleCompaniesFound, 0);
  });

  test('sin enrichments ejecutados la tasa de desperdicio es null, no cero', async () => {
    const { deps } = harness({ roundResults: [orgs('a', 5)] });

    const result = await run(deps);

    assert.equal(result.runMetrics.enrichmentsExecuted, 0);
    assert.equal(result.runMetrics.enrichmentWasteRate, null);
  });
});

// ─── § 12: idempotencia ───────────────────────────────────────────────────────

describe('§ 12 · idempotencia y concurrencia', () => {
  test('caso 24 — reintentar con las mismas claves no repite búsqueda ni enrichment', async () => {
    const first = harness({
      roundResults: [orgs('a', 3), orgs('b', 2)],
      assess: () => passingAssessment(),
    });
    const firstResult = await run(first.deps);
    assert.equal(first.recorder.searchCalls.length, 2);

    // Segundo intento con la MISMA correlación y las claves ya completadas.
    const second = harness({ roundResults: [orgs('a', 3), orgs('b', 2)] });
    const secondResult = await runApolloTwoRoundDiscovery(
      {
        config: testConfig(),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
        completedOperationKeys: firstResult.completedOperationKeys,
      },
      second.deps,
    );

    assert.equal(second.recorder.searchCalls.length, 0);
    assert.equal(second.recorder.enrichCalls.length, 0);
    assert.equal(secondResult.runMetrics.totalSearchCredits, 0);
    assert.equal(secondResult.runMetrics.totalEnrichmentCredits, 0);
  });

  test('las claves de operación son deterministas: mismos inputs, mismas claves', async () => {
    const a = harness({ roundResults: [orgs('a', 3), orgs('b', 1)] });
    const b = harness({ roundResults: [orgs('a', 3), orgs('b', 1)] });

    const resultA = await run(a.deps);
    const resultB = await run(b.deps);

    assert.deepEqual(resultA.completedOperationKeys, resultB.completedOperationKeys);
  });

  test('caso 29 — dos corridas concurrentes no mezclan claves de operación', async () => {
    const a = harness({ roundResults: [orgs('a', 3), orgs('b', 1)] });
    const b = harness({ roundResults: [orgs('a', 3), orgs('b', 1)] });

    const [resultA, resultB] = await Promise.all([
      runApolloTwoRoundDiscovery(
        {
          config: testConfig(),
          queryContext: testQueryContext(),
          correlation: testCorrelation({ idempotencyKey: 'run-a', batchId: 'batch-a' }),
        },
        a.deps,
      ),
      runApolloTwoRoundDiscovery(
        {
          config: testConfig(),
          queryContext: testQueryContext(),
          correlation: testCorrelation({ idempotencyKey: 'run-b', batchId: 'batch-b' }),
        },
        b.deps,
      ),
    ]);

    const shared = resultA.completedOperationKeys.filter((key) =>
      resultB.completedOperationKeys.includes(key),
    );
    assert.deepEqual(shared, []);
  });
});
